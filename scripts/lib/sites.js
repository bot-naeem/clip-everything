'use strict';

/**
 * Site adapters.
 *
 * Every function in this file is serialized and executed inside the page by
 * Playwright, so it must be self-contained: no closures over module state.
 *
 * A handler looks like:
 *   { id, match(url), ready(), extract() }
 *   - match   runs in Node, receives a WHATWG URL object
 *   - ready   optional page function used by page.waitForFunction()
 *   - extract optional page function returning a payload; when it is missing,
 *             or fails, the generic Defuddle extractor runs instead
 */

function pageZhihuAnswerExtract() {
	const host = location.hostname || '';
	const isZhihu = /(^|\.)zhihu\.com$/.test(host) && /\/question\//.test(location.pathname || '');

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
		root =
			document.querySelector('article') ||
			document.querySelector('main') ||
			document.querySelector('[role="main"]') ||
			document.body;
	}
	if (!root) {
		return { __error: 'no content root found' };
	}

	const cloned = root.cloneNode(true);
	cloned
		.querySelectorAll('.Catalog, .Catalog-content, .RichText-LinkCardContainer, script, style, noscript, .MathJax_SVG, .MathJax_Preview')
		.forEach((el) => el.remove());
	cloned.querySelectorAll('img').forEach((img) => {
		const preferred =
			img.getAttribute('data-actualsrc') || img.getAttribute('data-original') || img.getAttribute('src') || '';
		if (/^https?:\/\//i.test(preferred)) img.setAttribute('src', preferred);
		img.removeAttribute('srcset');
	});

	return {
		author: '',
		content: '<article>' + cloned.innerHTML + '</article>',
		description: '',
		domain: '',
		favicon: '',
		image: '',
		parseTime: 0,
		published: '',
		schemaOrgData: null,
		site,
		title: document.title || '',
		url: location.href,
		wordCount: 0,
		metaTags: [],
		text: cloned.textContent || '',
	};
}

function pageZhihuAnswerReady() {
	const stateOk = document.readyState === 'interactive' || document.readyState === 'complete';
	const rich = document.querySelector('.RichContent-inner');
	const richTextLen = rich ? (rich.innerText || '').trim().length : 0;
	const pCount = rich ? rich.querySelectorAll('p').length : 0;
	const hasArticle = !!document.querySelector('article');
	return stateOk && hasArticle && (pCount >= 3 || richTextLen >= 1200);
}

function pageZhihuZhuanlanExtract() {
	const articleRoot =
		document.querySelector('[itemprop="articleBody"]') ||
		document.querySelector('.Post-RichTextContainer .RichText') ||
		document.querySelector('.RichText.ztext') ||
		document.querySelector('article');

	if (!articleRoot) {
		return { __error: 'no article root found' };
	}

	const cloned = articleRoot.cloneNode(true);
	cloned
		.querySelectorAll(
			'.ContentItem-time, .Post-Sub, .Recommendations-Main, .TopstoryMain, .Post-Meta, .UserLink-Link, script, style, noscript, .MathJax_SVG, .MathJax_Preview'
		)
		.forEach((el) => el.remove());
	cloned.querySelectorAll('img').forEach((img) => {
		const preferred =
			img.getAttribute('data-actualsrc') || img.getAttribute('data-original') || img.getAttribute('src') || '';
		if (/^https?:\/\//i.test(preferred)) img.setAttribute('src', preferred);
		img.removeAttribute('srcset');
	});

	return {
		author: '',
		content: '<article>' + cloned.innerHTML + '</article>',
		description: '',
		domain: '',
		favicon: '',
		image: '',
		parseTime: 0,
		published: '',
		schemaOrgData: null,
		site: '知乎专栏',
		title: document.title || '',
		url: location.href,
		wordCount: 0,
		metaTags: [],
		text: cloned.textContent || '',
	};
}

const handlers = [
	{
		id: 'zhihu-answer',
		match(url) {
			return /(^|\.)zhihu\.com$/.test(url.hostname) && url.pathname.startsWith('/question/');
		},
		ready: pageZhihuAnswerReady,
		extract: pageZhihuAnswerExtract,
	},
	{
		id: 'zhihu-zhuanlan',
		match(url) {
			return /(^|\.)zhuanlan\.zhihu\.com$/.test(url.hostname) && url.pathname.startsWith('/p/');
		},
		extract: pageZhihuZhuanlanExtract,
	},
	{
		id: 'x-status',
		match(url) {
			return (/(^|\.)x\.com$/.test(url.hostname) || /(^|\.)twitter\.com$/.test(url.hostname)) && url.pathname.includes('/status/');
		},
	},
];

function findHandler(url) {
	const parsed = url instanceof URL ? url : new URL(String(url));
	return handlers.find((handler) => handler.match(parsed)) || null;
}

module.exports = {
	findHandler,
	handlers,
};
