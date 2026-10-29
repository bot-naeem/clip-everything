'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

const { buildFrontmatter } = require('./frontmatter');

const PARTIAL_ERROR_PREFIX = 'Partial conversion completed with errors.';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/* ------------------------------------------------------------------ *
 * Turndown (always available fallback)
 * ------------------------------------------------------------------ */

function convertToMarkdown(html, textFallback) {
	const turndown = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '*',
	});
	turndown.use(gfm);
	turndown.remove(['script', 'style', 'noscript', 'svg', 'canvas']);

	const md = turndown.turndown(String(html || '')).trim();
	if (md.length > 0) return md;
	return String(textFallback || '').trim();
}

/* ------------------------------------------------------------------ *
 * Original obsidian-clipper converter (src/utils/markdown-converter.ts)
 *
 * It has much better output than plain Turndown (callouts, math, tables,
 * footnotes, image captions). It is TypeScript from the browser extension,
 * so it needs jsdom globals and ts-node.
 * ------------------------------------------------------------------ */

let originalConverterLoaded = false;
let originalCreateMarkdownContent = null;
let originalConverterError = null;

const DOM_GLOBALS = [
	'Node',
	'Element',
	'HTMLElement',
	'HTMLTableElement',
	'HTMLIFrameElement',
	'HTMLInputElement',
	'HTMLOListElement',
	'DOMParser',
	'XMLSerializer',
];

// Node >= 21 exposes a read-only `navigator` global, so plain assignment throws.
function setGlobal(name, value) {
	try {
		global[name] = value;
		return;
	} catch {
		// fall through
	}
	try {
		Object.defineProperty(global, name, { value, configurable: true, writable: true });
	} catch {
		// give up silently; the converter has its own fallback
	}
}

function installDomGlobals(url) {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: url || 'https://example.com' });
	const win = dom.window;
	setGlobal('window', win);
	setGlobal('document', win.document);
	setGlobal('navigator', win.navigator);
	for (const name of DOM_GLOBALS) {
		setGlobal(name, win[name]);
	}
	return win;
}

function loadOriginalConverter(url) {
	installDomGlobals(url);
	if (originalConverterLoaded) return originalCreateMarkdownContent;

	require('ts-node').register({
		transpileOnly: true,
		compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
	});

	const mod = require('../../src/utils/markdown-converter.ts');
	originalCreateMarkdownContent = mod && typeof mod.createMarkdownContent === 'function' ? mod.createMarkdownContent : null;
	originalConverterLoaded = true;
	return originalCreateMarkdownContent;
}

function convertWithOriginalConverter(html, url) {
	try {
		const convert = loadOriginalConverter(url);
		if (!convert) return null;
		const md = convert(String(html || ''), String(url || ''));
		if (typeof md === 'string' && md.trim().length > 0) return md.trim();
		return null;
	} catch (error) {
		originalConverterError = error instanceof Error ? error.message : String(error);
		return null;
	}
}

const ISOLATED_RUNNER = `
const { JSDOM } = require('jsdom');
const url = process.argv[1] || 'https://example.com';
const html = Buffer.from(require('node:fs').readFileSync(0, 'utf8'), 'base64').toString('utf8');
const win = new JSDOM('<!doctype html><html><body></body></html>', { url }).window;
const setGlobal = (name, value) => {
	try { global[name] = value; } catch {
		try { Object.defineProperty(global, name, { value, configurable: true, writable: true }); } catch {}
	}
};
setGlobal('window', win);
setGlobal('document', win.document);
setGlobal('navigator', win.navigator);
for (const name of ${JSON.stringify(DOM_GLOBALS)}) setGlobal(name, win[name]);
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const mod = require('./src/utils/markdown-converter.ts');
process.stdout.write(String(mod.createMarkdownContent(String(html || ''), String(url || '')) || '').trim());
`;

/**
 * Run the original converter in a throwaway Node process.
 * HTML travels over stdin (not argv) because Windows caps the command line at ~32k.
 */
function convertWithOriginalConverterIsolated(html, url) {
	try {
		const out = execFileSync(process.execPath, ['-e', ISOLATED_RUNNER, String(url || '')], {
			cwd: REPO_ROOT,
			input: Buffer.from(String(html || ''), 'utf8').toString('base64'),
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
		});
		const md = String(out || '').trim();
		return md || null;
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ *
 * Post-processing
 * ------------------------------------------------------------------ */

/** Zhihu articles append "编辑于 …", "所属专栏 …" and other UI noise at the end. */
function trimZhihuArticleTail(markdown, url) {
	let host = '';
	try {
		host = new URL(String(url || '')).hostname;
	} catch {
		return markdown;
	}
	if (!/(^|\.)zhuanlan\.zhihu\.com$/.test(host)) return markdown;

	const lines = String(markdown || '').split('\n');
	const cutAt = lines.findIndex((line) => {
		const text = line.trim();
		return (
			/^编辑于\s+/.test(text) ||
			/^发布于\s+/.test(text) ||
			text.startsWith('还没有人送礼物') ||
			text.startsWith('[所属专栏') ||
			text.startsWith('所属专栏 ·')
		);
	});
	if (cutAt <= 0) return markdown;
	return `${lines.slice(0, cutAt).join('\n').trimEnd()}\n`;
}

function buildMarkdown(payload, includeFrontmatter, now = new Date()) {
	let converted = convertWithOriginalConverter(payload.content, payload.url);
	let converterUsed = converted ? 'obsidian-converter' : 'turndown';

	if (converted && converted.startsWith(PARTIAL_ERROR_PREFIX)) {
		const isolated = convertWithOriginalConverterIsolated(payload.content, payload.url);
		if (isolated && !isolated.startsWith(PARTIAL_ERROR_PREFIX)) {
			converted = isolated;
			converterUsed = 'obsidian-converter-isolated';
		}
	}

	const hasHtmlTable = /<table/i.test(String(payload.content || ''));
	const missingMdTable = !converted || !/^\|.+\|/m.test(converted);
	if (hasHtmlTable && missingMdTable) {
		const isolated = convertWithOriginalConverterIsolated(payload.content, payload.url);
		if (isolated) {
			converted = isolated;
			converterUsed = 'obsidian-converter-isolated';
		}
	}

	let body = converted || convertToMarkdown(payload.content, payload.text);
	body = trimZhihuArticleTail(body, payload.url);

	const heading = `# ${payload.title || 'Untitled'}\n\n`;
	const frontmatter = includeFrontmatter ? buildFrontmatter(payload, now) : '';
	return { markdown: `${frontmatter}${heading}${body}\n`, converterUsed };
}

module.exports = {
	PARTIAL_ERROR_PREFIX,
	buildMarkdown,
	convertToMarkdown,
	convertWithOriginalConverter,
	trimZhihuArticleTail,
};
