const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

function printUsage() {
	console.log([
		'Usage:',
		'  npm run clip -- <url> [--output <dir>] [--filename <pattern>] [--profile <name>] [--wait <load|domcontentloaded|networkidle>] [--timeout-ms <n>] [--no-frontmatter]',
		'',
		'Example:',
		'  npm run clip -- "https://example.com" --output clips --filename "{date}-{title}" --profile openclaw --wait networkidle',
		'',
		'Filename pattern tokens:',
		'  {title} {domain} {date} {time}'
	].join('\n'));
}

class StageError extends Error {
	constructor(stage, message, cause) {
		super(message);
		this.name = 'StageError';
		this.stage = stage;
		this.cause = cause;
	}
}

function parseArgs(argv) {
	const args = [...argv];
	const first = args[0];
	if (!first || first === '--help' || first === '-h') {
		printUsage();
		process.exit(first ? 0 : 1);
	}

	const options = {
		url: first,
		outputDir: path.resolve(process.cwd(), 'clips'),
		profile: 'openclaw',
		wait: 'networkidle',
		timeoutMs: 30000,
		frontmatter: true,
		filenamePattern: '{title}'
	};

	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--output') {
			const value = args[++i];
			if (!value) throw new Error('Missing value for --output');
			options.outputDir = path.resolve(process.cwd(), value);
			continue;
		}
		if (arg === '--profile') {
			const value = args[++i];
			if (!value) throw new Error('Missing value for --profile');
			options.profile = value;
			continue;
		}
		if (arg === '--filename') {
			const value = args[++i];
			if (!value) throw new Error('Missing value for --filename');
			options.filenamePattern = value;
			continue;
		}
		if (arg === '--wait') {
			const value = args[++i];
			if (!value || !['load', 'domcontentloaded', 'networkidle'].includes(value)) {
				throw new Error('Invalid --wait value. Use load|domcontentloaded|networkidle');
			}
			options.wait = value;
			continue;
		}
		if (arg === '--timeout-ms') {
			const value = Number(args[++i]);
			if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid --timeout-ms value');
			options.timeoutMs = value;
			continue;
		}
		if (arg === '--no-frontmatter') {
			options.frontmatter = false;
			continue;
		}
		if (arg === '--frontmatter') {
			options.frontmatter = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
}

function runOpenClawJson(args) {
	const output = execFileSync('openclaw', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	return JSON.parse(output);
}

function createDom(html, url) {
	const virtualConsole = new VirtualConsole();
	virtualConsole.on('jsdomError', () => {
		// Ignore noisy stylesheet parse warnings from third-party pages.
	});
	return new JSDOM(String(html || ''), {
		url: url || 'https://example.com',
		virtualConsole
	});
}

function runStage(stage, fn) {
	try {
		return fn();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new StageError(stage, message, error);
	}
}

function ensureBrowserRunning(profile) {
	const status = runOpenClawJson(['browser', '--browser-profile', profile, 'status', '--json']);
	if (status.running) return;
	runOpenClawJson(['browser', '--browser-profile', profile, 'start', '--json']);
}

function waitForPage(profile, targetId, wait, timeoutMs) {
	// Phase 1: browser load state.
	try {
		runOpenClawJson([
			'browser', '--browser-profile', profile, 'wait',
			'--target-id', targetId,
			'--load', wait,
			'--timeout-ms', String(timeoutMs),
			'--json'
		]);
	} catch (error) {
		// For pages with long-lived connections (e.g. X), networkidle often never stabilizes.
		// Fallback to domcontentloaded before "ready-to-clip" probing.
		if (wait === 'networkidle') {
			runOpenClawJson([
				'browser', '--browser-profile', profile, 'wait',
				'--target-id', targetId,
				'--load', 'domcontentloaded',
				'--timeout-ms', String(timeoutMs),
				'--json'
			]);
		} else {
			throw error;
		}
	}

	// Phase 2: "ready-to-clip" heuristic.
	// For Zhihu, wait until answer/article content is materially rendered.
	const readyFn = `() => {
		const stateOk = document.readyState === 'interactive' || document.readyState === 'complete';
		const root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
		const textLen = (root?.innerText || '').trim().length;
		const host = location.hostname || '';
		const isZhihu = /(^|\\.)zhihu\\.com$/.test(host);
		if (isZhihu) {
			const rich = document.querySelector('.RichContent-inner');
			const richTextLen = (rich?.innerText || '').trim().length;
			const pCount = rich ? rich.querySelectorAll('p').length : 0;
			const hasArticle = !!document.querySelector('article');
			return stateOk && hasArticle && (pCount >= 3 || richTextLen >= 1200);
		}
		const hasStructure = !!(root && root.querySelector('p, li, table, pre, h2, h3'));
		return stateOk && hasStructure && textLen >= 600;
	}`;
	runOpenClawJson([
		'browser', '--browser-profile', profile, 'wait',
		'--target-id', targetId,
		'--fn', readyFn,
		'--timeout-ms', String(timeoutMs),
		'--json'
	]);
}

function openUrl(profile, url) {
	return runOpenClawJson(['browser', '--browser-profile', profile, 'open', url, '--json']);
}

let browserDefuddleBundle = null;

function evaluateInBrowser(profile, targetId, fn, timeoutMs = 20000) {
	const args = [
		'browser', '--browser-profile', profile, '--timeout', String(timeoutMs), 'evaluate',
		'--target-id', targetId,
		'--fn', fn,
		'--json'
	];
	const result = runOpenClawJson(args);
	const payload = result.result;
	if (payload && payload.__error) {
		throw new Error(payload.__error);
	}
	return payload;
}

function getBrowserDefuddleBundle() {
	if (browserDefuddleBundle) return browserDefuddleBundle;
	const bundlePath = path.resolve(__dirname, '../node_modules/defuddle/dist/index.js');
	browserDefuddleBundle = fs.readFileSync(bundlePath, 'utf8');
	return browserDefuddleBundle;
}

function ensureDefuddleInBrowser(profile, targetId, timeoutMs) {
	const bundle = getBrowserDefuddleBundle();
	const bundleLiteral = JSON.stringify(bundle);
	const fn = `() => {
		try {
			if (typeof window.Defuddle === 'function') return { ok: true };
			(0, eval)(${bundleLiteral});
			if (typeof window.Defuddle !== 'function') {
				return { __error: 'Defuddle was not initialized in browser context' };
			}
			return { ok: true };
		} catch (error) {
			return { __error: String(error && error.message ? error.message : error) };
		}
	}`;
	evaluateInBrowser(profile, targetId, fn, timeoutMs);
}

function extractPageContentInBrowser(profile, targetId, timeoutMs) {
	const pageInfo = evaluateInBrowser(profile, targetId, `() => ({
		host: location.hostname || '',
		path: location.pathname || '',
		url: location.href,
		title: document.title || ''
	})`, timeoutMs);
	const isZhihuAnswer = /(^|\.)zhihu\.com$/.test(pageInfo.host) && /\/question\//.test(pageInfo.path);
	const isZhihuZhuanlan = /(^|\.)zhuanlan\.zhihu\.com$/.test(pageInfo.host) && /\/p\//.test(pageInfo.path);
	if (isZhihuAnswer) {
		const sitePayloadFn = `() => {
			const host = location.hostname || '';
			const isZhihu = /(^|\\.)zhihu\\.com$/.test(host) && /\\/question\\//.test(location.pathname || '');
			let root = null;
			let site = '';
			if (isZhihu) {
				site = '知乎回答';
				root =
					document.querySelector('.RichContent [itemprop="text"]') ||
					document.querySelector('.RichText.ztext[itemprop="text"]') ||
					document.querySelector('#content .RichText') ||
					document.querySelector('.RichContent-inner');
			}
			if (!root) {
				root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
			}
			const cloned = root.cloneNode(true);
			cloned.querySelectorAll(
				'.Catalog, .Catalog-content, .RichText-LinkCardContainer, script, style, noscript, .MathJax_SVG, .MathJax_Preview'
			).forEach(el => el.remove());
			cloned.querySelectorAll('img').forEach(img => {
				const preferred =
					img.getAttribute('data-actualsrc') ||
					img.getAttribute('data-original') ||
					img.getAttribute('src') ||
					'';
				if (/^https?:\\/\\//i.test(preferred)) {
					img.setAttribute('src', preferred);
				}
				img.removeAttribute('srcset');
			});
			return {
				author: '',
				content: '<article>' + cloned.innerHTML + '</article>',
				description: '',
				domain: '',
				extractedContent: {},
				favicon: '',
				fullHtml: '',
				highlights: [],
				image: '',
				parseTime: 0,
				published: '',
				schemaOrgData: null,
				selectedHtml: '',
				site,
				title: document.title || '',
				url: location.href,
				wordCount: 0,
				metaTags: [],
				text: cloned.textContent || ''
			};
		}`;
		const payload = evaluateInBrowser(profile, targetId, sitePayloadFn, timeoutMs);
		payload.domain = getDomainFromOriginalUtils(payload.url);
		return payload;
	}
	if (isZhihuZhuanlan) {
		const sitePayloadFn = `() => {
			const articleRoot =
				document.querySelector('[itemprop="articleBody"]') ||
				document.querySelector('.Post-RichTextContainer .RichText') ||
				document.querySelector('.RichText.ztext') ||
				document.querySelector('article');
			const cloned = articleRoot ? articleRoot.cloneNode(true) : document.createElement('div');
			cloned.querySelectorAll(
				'.ContentItem-time, .Post-Sub, .Recommendations-Main, .TopstoryMain, .Post-Meta, .UserLink-Link, script, style, noscript, .MathJax_SVG, .MathJax_Preview'
			).forEach(el => el.remove());
			cloned.querySelectorAll('img').forEach(img => {
				const preferred =
					img.getAttribute('data-actualsrc') ||
					img.getAttribute('data-original') ||
					img.getAttribute('src') ||
					'';
				if (/^https?:\\/\\//i.test(preferred)) {
					img.setAttribute('src', preferred);
				}
				img.removeAttribute('srcset');
			});
			return {
				author: '',
				content: '<article>' + cloned.innerHTML + '</article>',
				description: '',
				domain: '',
				extractedContent: {},
				favicon: '',
				fullHtml: '',
				highlights: [],
				image: '',
				parseTime: 0,
				published: '',
				schemaOrgData: null,
				selectedHtml: '',
				site: '知乎专栏',
				title: document.title || '',
				url: location.href,
				wordCount: 0,
				metaTags: [],
				text: cloned.textContent || ''
			};
		}`;
		const payload = evaluateInBrowser(profile, targetId, sitePayloadFn, timeoutMs);
		payload.domain = getDomainFromOriginalUtils(payload.url);
		return payload;
	}
	const fn = `() => {
		try {
			const defuddled = new window.Defuddle(document, { url: document.URL }).parse();
			let contentHtml = defuddled.content || '';
			const isZhihuAnswerPage = /(^|\\.)zhihu\\.com$/.test(location.hostname || '') && /\\/question\\//.test(location.pathname || '');
			if (isZhihuAnswerPage) {
				const parser = new DOMParser();
				const defDoc = parser.parseFromString(contentHtml, 'text/html');
				const defParagraphCount = defDoc.querySelectorAll('p').length;
				const rich = document.querySelector('.RichContent-inner');
				const richParagraphCount = rich ? rich.querySelectorAll('p').length : 0;
				const richTextLen = (rich?.textContent || '').trim().length;
				// Zhihu answers may still be hydrating when Defuddle runs; use the rendered answer body only when Defuddle output is clearly collapsed.
				if (rich && richTextLen >= 500 && (defParagraphCount <= 2 && richParagraphCount >= 3)) {
					contentHtml = '<article>' + rich.innerHTML + '</article>';
				}
			}
			const mainContentEl = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
			if (mainContentEl) {
				const probe = document.createElement('div');
				probe.innerHTML = contentHtml;
				const defTableCount = probe.querySelectorAll('table').length;
				const mainTableCount = mainContentEl.querySelectorAll('table').length;
				if (mainTableCount > 0) {
					const defTextLen = (probe.textContent || '').trim().length;
					const mainTextLen = (mainContentEl.textContent || '').trim().length;
					if (defTableCount === 0 || mainTextLen >= Math.floor(defTextLen * 0.6)) {
						contentHtml = mainContentEl.outerHTML;
					}
				}
			}

			return {
				author: defuddled.author || '',
				content: contentHtml,
				description: defuddled.description || '',
				domain: '',
				extractedContent: {},
				favicon: defuddled.favicon || '',
				fullHtml: '',
				highlights: [],
				image: defuddled.image || '',
				parseTime: defuddled.parseTime || 0,
				published: defuddled.published || '',
				schemaOrgData: defuddled.schemaOrgData || null,
				selectedHtml: '',
				site: defuddled.site || '',
				title: defuddled.title || document.title || '',
				url: location.href,
				wordCount: defuddled.wordCount || 0,
				metaTags: defuddled.metaTags || [],
				text: document.body ? (document.body.textContent || '') : ''
			};
		} catch (error) {
			return { __error: String(error && error.message ? error.message : error) };
		}
	}`;
	const fallbackFn = `() => {
		try {
			const host = location.hostname || '';
			const isX = /(^|\\.)x\\.com$/.test(host) || /(^|\\.)twitter\\.com$/.test(host);
			let root = null;
			if (isX && /\\/status\\//.test(location.pathname || '')) {
				root = document.querySelector('article[data-testid="tweet"]') || document.querySelector('[data-testid="primaryColumn"] article');
			}
			if (!root) {
				root = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
			}
			const text = root ? (root.textContent || '') : (document.body ? (document.body.textContent || '') : '');
			return {
				author: '',
				content: root ? root.outerHTML : (document.body ? document.body.innerHTML : ''),
				description: '',
				domain: '',
				extractedContent: {},
				favicon: '',
				fullHtml: '',
				highlights: [],
				image: '',
				parseTime: 0,
				published: '',
				schemaOrgData: null,
				selectedHtml: '',
				site: '',
				title: document.title || '',
				url: location.href,
				wordCount: 0,
				metaTags: [],
				text
			};
		} catch (error) {
			return { __error: String(error && error.message ? error.message : error) };
		}
	}`;
	let payload;
	try {
		ensureDefuddleInBrowser(profile, targetId, timeoutMs);
		payload = evaluateInBrowser(profile, targetId, fn, timeoutMs);
	} catch {
		payload = evaluateInBrowser(profile, targetId, fallbackFn, timeoutMs);
	}
	payload.domain = getDomainFromOriginalUtils(payload.url);
	return payload;
}

function sanitizeFileName(input) {
	const sanitized = input
		.replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
		.replace(/^\.+/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
	return sanitized || 'Untitled';
}

function renderFilename(pattern, payload) {
	const now = new Date();
	const date = now.toISOString().slice(0, 10);
	const time = now.toISOString().slice(11, 19).replace(/:/g, '-');
	const domain = (() => {
		try {
			return new URL(payload.url || '').hostname;
		} catch {
			return 'unknown';
		}
	})();
	const title = payload.title || 'Untitled';

	const replacements = {
		'{title}': title,
		'{domain}': domain,
		'{date}': date,
		'{time}': time
	};

	let rendered = pattern;
	for (const [token, value] of Object.entries(replacements)) {
		rendered = rendered.split(token).join(String(value));
	}
	return sanitizeFileName(rendered);
}

function uniquePath(target) {
	if (!fs.existsSync(target)) return target;
	const ext = path.extname(target);
	const base = target.slice(0, -ext.length);
	for (let i = 1; i < 1000; i++) {
		const candidate = `${base} ${i}${ext}`;
		if (!fs.existsSync(candidate)) return candidate;
	}
	throw new Error('Could not find unique output filename');
}

function escapeYaml(value) {
	return String(value || '').replace(/"/g, '\\"');
}

function convertToMarkdown(html, textFallback) {
	const turndown = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
		emDelimiter: '*'
	});
	turndown.use(gfm);
	turndown.remove(['script', 'style', 'noscript', 'svg', 'canvas']);
	const md = turndown.turndown(String(html || '')).trim();
	if (md.length > 0) return md;
	return String(textFallback || '').trim();
}

let originalConverterLoaded = false;
let originalCreateMarkdownContent = null;
let originalConverterError = null;
let originalStringUtilsLoaded = false;
let originalGetDomain = null;

function installDomGlobals(urlForDom) {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: urlForDom || 'https://example.com' });
	const win = dom.window;
	global.window = win;
	global.document = win.document;
	global.navigator = win.navigator;
	global.Node = win.Node;
	global.Element = win.Element;
	global.HTMLElement = win.HTMLElement;
	global.HTMLTableElement = win.HTMLTableElement;
	global.HTMLIFrameElement = win.HTMLIFrameElement;
	global.HTMLInputElement = win.HTMLInputElement;
	global.HTMLOListElement = win.HTMLOListElement;
	global.DOMParser = win.DOMParser;
	global.XMLSerializer = win.XMLSerializer;
}

function loadOriginalConverter(urlForDom) {
	// Always refresh globals so instanceof checks stay consistent.
	installDomGlobals(urlForDom);
	if (originalConverterLoaded) return originalCreateMarkdownContent;

	require('ts-node').register({
		transpileOnly: true,
		compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
	});

	const mod = require('../src/utils/markdown-converter.ts');
	originalCreateMarkdownContent = mod && mod.createMarkdownContent ? mod.createMarkdownContent : null;
	originalConverterLoaded = true;
	return originalCreateMarkdownContent;
}

function loadOriginalStringUtils(urlForDom) {
	installDomGlobals(urlForDom);
	if (originalStringUtilsLoaded) return originalGetDomain;

	require('ts-node').register({
		transpileOnly: true,
		compilerOptions: { module: 'CommonJS', moduleResolution: 'node' }
	});

	const mod = require('../src/utils/string-utils.ts');
	originalGetDomain = mod && typeof mod.getDomain === 'function' ? mod.getDomain : null;
	originalStringUtilsLoaded = true;
	return originalGetDomain;
}

function getDomainFromOriginalUtils(url) {
	try {
		const fn = loadOriginalStringUtils(url);
		if (!fn) return '';
		return fn(String(url || ''));
	} catch {
		return '';
	}
}

function convertWithOriginalConverter(html, url) {
	try {
		const fn = loadOriginalConverter(url);
		if (!fn) return null;
		const md = fn(String(html || ''), String(url || ''));
		if (typeof md === 'string' && md.trim().length > 0) return md.trim();
		return null;
	} catch (error) {
		originalConverterError = error instanceof Error ? error.message : String(error);
		return null;
	}
}

function convertWithOriginalConverterIsolated(html, url) {
	const htmlB64 = Buffer.from(String(html || ''), 'utf8').toString('base64');
	const runner = `
const { JSDOM } = require('jsdom');
const url = process.argv[1] || 'https://example.com';
const html = Buffer.from(process.argv[2] || '', 'base64').toString('utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
const win = dom.window;
global.window = win;
global.document = win.document;
global.navigator = win.navigator;
global.Node = win.Node;
global.Element = win.Element;
global.HTMLElement = win.HTMLElement;
global.HTMLTableElement = win.HTMLTableElement;
global.HTMLIFrameElement = win.HTMLIFrameElement;
global.HTMLInputElement = win.HTMLInputElement;
global.HTMLOListElement = win.HTMLOListElement;
global.DOMParser = win.DOMParser;
global.XMLSerializer = win.XMLSerializer;
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'node' } });
const mod = require('./src/utils/markdown-converter.ts');
const md = mod.createMarkdownContent(String(html || ''), String(url || ''));
process.stdout.write(String(md || '').trim());
`;
	try {
		const out = execFileSync('node', ['-e', runner, String(url || ''), htmlB64], {
			encoding: 'utf8',
			cwd: path.resolve(__dirname, '..')
		});
		const md = String(out || '').trim();
		return md || null;
	} catch {
		return null;
	}
}

function buildFrontmatter(payload) {
	const lines = [
		'---',
		`title: "${escapeYaml(payload.title)}"`,
		`source: "${escapeYaml(payload.url)}"`,
		`author: "${escapeYaml(payload.author)}"`,
		`site: "${escapeYaml(payload.site)}"`,
		`published: "${escapeYaml(payload.published)}"`,
		`description: "${escapeYaml(payload.description)}"`,
		`clipped_at: "${new Date().toISOString()}"`,
		'---',
		''
	];
	return lines.join('\n');
}

function trimZhihuArticleTail(markdown, url) {
	let host = '';
	try {
		host = new URL(String(url || '')).hostname || '';
	} catch {}
	if (!/(^|\.)zhuanlan\.zhihu\.com$/.test(host)) return markdown;
	const lines = String(markdown || '').split('\n');
	const cutAt = lines.findIndex(line => {
		const t = line.trim();
		return (
			/^编辑于\s+/.test(t) ||
			/^发布于\s+/.test(t) ||
			t.startsWith('还没有人送礼物') ||
			t.startsWith('[所属专栏') ||
			t.startsWith('所属专栏 ·')
		);
	});
	if (cutAt <= 0) return markdown;
	return lines.slice(0, cutAt).join('\n').trimEnd() + '\n';
}

function buildMarkdown(payload, includeFrontmatter) {
	let originalMd = convertWithOriginalConverter(payload.content, payload.url);
	let converterUsed = originalMd ? 'original-createMarkdownContent' : 'fallback-turndown';
	const partialErrorPrefix = 'Partial conversion completed with errors.';
	if (originalMd && originalMd.startsWith(partialErrorPrefix)) {
		const isolatedMd = convertWithOriginalConverterIsolated(payload.content, payload.url);
		if (isolatedMd && !isolatedMd.startsWith(partialErrorPrefix)) {
			originalMd = isolatedMd;
			converterUsed = 'original-createMarkdownContent-isolated';
		}
	}

	const hasHtmlTable = /<table/i.test(String(payload.content || ''));
	const missingMdTable = !originalMd || !/^\|.+\|/m.test(originalMd);
	if (hasHtmlTable && missingMdTable) {
		const isolatedMd = convertWithOriginalConverterIsolated(payload.content, payload.url);
		if (isolatedMd) {
			originalMd = isolatedMd;
			converterUsed = 'original-createMarkdownContent-isolated';
		}
	}

	let mdBody = originalMd || convertToMarkdown(payload.content, payload.text);
	mdBody = trimZhihuArticleTail(mdBody, payload.url);
	const heading = `# ${payload.title || 'Untitled'}\n\n`;
	if (includeFrontmatter) return { markdown: `${buildFrontmatter(payload)}${heading}${mdBody}\n`, converterUsed };
	return { markdown: `${heading}${mdBody}\n`, converterUsed };
}

function writeMarkdownFile(outputDir, fileStem, markdown) {
	fs.mkdirSync(outputDir, { recursive: true });
	const target = path.join(outputDir, `${sanitizeFileName(fileStem)}.md`);
	const outputPath = uniquePath(target);
	fs.writeFileSync(outputPath, markdown, 'utf8');
	return outputPath;
}

function main() {
	const startMs = Date.now();
	try {
		const options = parseArgs(process.argv.slice(2));
		runStage('start', () => ensureBrowserRunning(options.profile));
		const opened = runStage('open', () => openUrl(options.profile, options.url));
		try {
			runStage('wait', () => waitForPage(options.profile, opened.targetId, options.wait, options.timeoutMs));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(JSON.stringify({
				ok: true,
				warn: 'wait_failed_continue_extract',
				waitMode: options.wait,
				message
			}));
		}
		const payload = runStage('extract', () => extractPageContentInBrowser(options.profile, opened.targetId, options.timeoutMs));
		const transformed = runStage('transform', () => buildMarkdown(payload, options.frontmatter));
		const markdown = transformed.markdown;
		const fileStem = renderFilename(options.filenamePattern, payload);
		const outputPath = runStage('write', () => writeMarkdownFile(options.outputDir, fileStem, markdown));

		console.log(JSON.stringify({
			ok: true,
			url: payload.url,
			title: payload.title,
			outputPath,
			contentLength: markdown.length,
			converterUsed: transformed.converterUsed,
			converterError: transformed.converterUsed === 'fallback-turndown' ? originalConverterError : null,
			elapsedMs: Date.now() - startMs
		}, null, 2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const stage = error instanceof StageError ? error.stage : 'unknown';
		console.error(JSON.stringify({
			ok: false,
			stage,
			error: message,
			elapsedMs: Date.now() - startMs
		}, null, 2));
		process.exit(1);
	}
}

main();
