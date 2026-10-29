'use strict';

const fs = require('node:fs');

const { StageError } = require('./errors');
const { getDomain } = require('./naming');
const { findHandler } = require('./sites');

let defuddleBundle = null;

function loadDefuddleBundle() {
	if (defuddleBundle !== null) return defuddleBundle;
	try {
		// require.resolve('defuddle') -> node_modules/defuddle/dist/index.js (UMD, sets window.Defuddle)
		defuddleBundle = fs.readFileSync(require.resolve('defuddle'), 'utf8');
	} catch (error) {
		throw new StageError('extract', 'defuddle is not installed. Run: npm install', error);
	}
	return defuddleBundle;
}

const hasDefuddle = () => typeof window.Defuddle === 'function';

/**
 * Inject the Defuddle bundle into the page.
 *
 * `page.evaluate(bundle)` goes through CDP Runtime.evaluate, which is not subject
 * to the page's CSP - unlike an inline <script> tag. addScriptTag is kept as a
 * fallback for pages that block Runtime.evaluate.
 */
async function injectDefuddle(page) {
	if (await page.evaluate(hasDefuddle)) return true;

	const bundle = loadDefuddleBundle();

	try {
		await page.evaluate(bundle);
	} catch {
		// fall through to the <script> strategy
	}
	if (await page.evaluate(hasDefuddle)) return true;

	try {
		await page.addScriptTag({ content: bundle });
	} catch {
		// CSP blocked inline scripts as well
	}
	return page.evaluate(hasDefuddle);
}

/* ------------------------------------------------------------------ *
 * Page-side functions. They are serialized and run inside the browser,
 * so they must not reference anything from this module's scope.
 * ------------------------------------------------------------------ */

function pageProbe() {
	return {
		host: location.hostname || '',
		path: location.pathname || '',
		url: location.href,
		title: document.title || '',
		readyState: document.readyState,
	};
}

function pageWaitReady() {
	const stateOk = document.readyState === 'interactive' || document.readyState === 'complete';
	const root =
		document.querySelector('article') ||
		document.querySelector('main') ||
		document.querySelector('[role="main"]') ||
		document.body;
	const text = root ? (root.innerText || root.textContent || '').trim() : '';
	const hasStructure = !!(root && root.querySelector('p, li, table, pre, h2, h3'));
	return stateOk && hasStructure && text.length >= 600;
}

/**
 * Detect anti-bot / login walls so we fail with a useful message instead of
 * writing an "Untitled.md" that contains a captcha notice.
 */
function pageDetectBlocked() {
	const body = document.body;
	const text = ((body && (body.innerText || body.textContent)) || '').trim();
	const title = document.title || '';

	const signature =
		/"code"\s*:\s*40362|请求存在异常|访问过于频繁|安全验证|请完成验证|Just a moment|Enable JavaScript and cookies to continue|Verify you are human/i;

	if (signature.test(text) && text.length < 2000) {
		return { reason: 'anti-bot wall', snippet: text.slice(0, 160) };
	}
	if (!title && text.length < 300) {
		return { reason: 'empty page (login wall?)', snippet: text.slice(0, 160) };
	}
	return null;
}

function pageExtractWithDefuddle() {
	if (typeof window.Defuddle !== 'function') {
		return { __error: 'Defuddle was not injected into this page' };
	}

	const defuddled = new window.Defuddle(document, { url: document.URL }).parse();
	let contentHtml = defuddled.content || '';

	// Zhihu answers may still be hydrating when Defuddle runs; fall back to the
	// rendered answer body only when Defuddle output is clearly collapsed.
	const isZhihuAnswerPage = /(^|\.)zhihu\.com$/.test(location.hostname || '') && /\/question\//.test(location.pathname || '');
	if (isZhihuAnswerPage) {
		const parser = new DOMParser();
		const defDoc = parser.parseFromString(contentHtml, 'text/html');
		const defParagraphCount = defDoc.querySelectorAll('p').length;
		const rich = document.querySelector('.RichContent-inner');
		const richParagraphCount = rich ? rich.querySelectorAll('p').length : 0;
		const richTextLen = rich ? (rich.textContent || '').trim().length : 0;
		if (rich && richTextLen >= 500 && defParagraphCount <= 2 && richParagraphCount >= 3) {
			contentHtml = '<article>' + rich.innerHTML + '</article>';
		}
	}

	// Rescue hatch: Defuddle occasionally collapses to almost nothing on pages
	// whose layout confuses it. Only then fall back to the whole main element.
	const mainContentEl =
		document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
	if (mainContentEl) {
		const probe = document.createElement('div');
		probe.innerHTML = contentHtml;
		const defTextLen = (probe.textContent || '').trim().length;
		const mainTextLen = (mainContentEl.textContent || '').trim().length;
		const mainTableCount = mainContentEl.querySelectorAll('table').length;
		const collapsed = defTextLen < 200 && mainTextLen > defTextLen * 3;
		if (collapsed && mainTableCount > 0) {
			contentHtml = mainContentEl.outerHTML;
		}
	}

	const textRoot =
		document.querySelector('article') ||
		document.querySelector('main') ||
		document.querySelector('[role="main"]') ||
		document.body;

	return {
		author: defuddled.author || '',
		content: contentHtml,
		description: defuddled.description || '',
		domain: '',
		favicon: defuddled.favicon || '',
		image: defuddled.image || '',
		parseTime: defuddled.parseTime || 0,
		published: defuddled.published || '',
		schemaOrgData: defuddled.schemaOrgData || null,
		site: defuddled.site || '',
		title: defuddled.title || document.title || '',
		url: location.href,
		wordCount: defuddled.wordCount || 0,
		metaTags: defuddled.metaTags || [],
		text: textRoot ? textRoot.innerText || textRoot.textContent || '' : '',
	};
}

function pageExtractFallback() {
	const host = location.hostname || '';
	const isX = /(^|\.)x\.com$/.test(host) || /(^|\.)twitter\.com$/.test(host);

	let root = null;
	if (isX && /\/status\//.test(location.pathname || '')) {
		root =
			document.querySelector('article[data-testid="tweet"]') ||
			document.querySelector('[data-testid="primaryColumn"] article');
	}
	if (!root) {
		root =
			document.querySelector('article') ||
			document.querySelector('main') ||
			document.querySelector('[role="main"]') ||
			document.body;
	}
	if (!root) {
		return { __error: 'no content root found' };
	}

	return {
		author: '',
		content: root.outerHTML,
		description: '',
		domain: '',
		favicon: '',
		image: '',
		parseTime: 0,
		published: '',
		schemaOrgData: null,
		site: '',
		title: document.title || '',
		url: location.href,
		wordCount: 0,
		metaTags: [],
		text: root.innerText || root.textContent || '',
	};
}

/* ------------------------------------------------------------------ */

async function waitForReady(page, handler, timeoutMs) {
	const ready = handler && handler.ready ? handler.ready : pageWaitReady;
	await page.waitForFunction(ready, undefined, { timeout: timeoutMs, polling: 500 });
}

async function detectBlocked(page) {
	try {
		return await page.evaluate(pageDetectBlocked);
	} catch {
		return null;
	}
}

function describeError(error) {
	if (!error) return 'unknown error';
	return error instanceof Error ? error.message : String(error);
}

async function extract(page, options) {
	const handler = findHandler(options.url);
	const attempts = [];

	if (handler && handler.extract) {
		attempts.push({ name: handler.id, fn: handler.extract, needDefuddle: false });
	}
	attempts.push({ name: 'defuddle', fn: pageExtractWithDefuddle, needDefuddle: true });
	attempts.push({ name: 'fallback-dom', fn: pageExtractFallback, needDefuddle: false });

	const failures = [];

	for (const attempt of attempts) {
		try {
			if (attempt.needDefuddle && !(await injectDefuddle(page))) {
				failures.push(`${attempt.name}: Defuddle could not be injected`);
				continue;
			}

			const payload = await page.evaluate(attempt.fn);
			if (!payload) throw new Error('extractor returned nothing');
			if (payload.__error) throw new Error(payload.__error);
			if (!payload.content || !String(payload.content).trim()) throw new Error('extracted content is empty');

			const probe = await page.evaluate(pageProbe);
			payload.url = payload.url || probe.url;
			payload.title = payload.title || probe.title;
			if (handler && typeof handler.cleanTitle === 'function') {
				payload.title = handler.cleanTitle(payload.title, payload.url) || payload.title;
			}
			payload.domain = payload.domain || getDomain(payload.url);
			payload.extractor = attempt.name;
			return payload;
		} catch (error) {
			failures.push(`${attempt.name}: ${describeError(error)}`);
		}
	}

	throw new StageError('extract', `all extraction strategies failed (${failures.join(' | ')})`);
}

module.exports = {
	detectBlocked,
	extract,
	injectDefuddle,
	loadDefuddleBundle,
	pageDetectBlocked,
	pageProbe,
	waitForReady,
};
