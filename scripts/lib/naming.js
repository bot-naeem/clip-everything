'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_STEM_LENGTH = 120;

/**
 * Turn arbitrary text into a filename stem that is safe on Windows, macOS and Linux.
 * Windows rejects <>:"/\|?* plus control chars, trailing dots/spaces and reserved names.
 */
function sanitizeFileName(input) {
	let out = String(input === undefined || input === null ? '' : input)
		.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
		.replace(/[\u200B-\u200D\uFEFF]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.replace(/[. ]+$/, '')
		.slice(0, MAX_STEM_LENGTH)
		.trim();

	if (!out) return 'Untitled';
	if (WINDOWS_RESERVED.test(out)) out = `${out}_`;
	return out;
}

function pad(value) {
	return String(value).padStart(2, '0');
}

function formatDate(date, separator = '-') {
	return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(separator);
}

function formatTime(date, separator = '-') {
	return [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(separator);
}

function getDomain(input) {
	try {
		const hostname = new URL(String(input)).hostname.toLowerCase();
		if (!hostname) return '';
		if (hostname === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;

		const parts = hostname.split('.');
		if (parts.length <= 2) return hostname;

		const twoLevelSuffixes = new Set([
			'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
			'com.au', 'net.au', 'org.au',
			'co.jp', 'or.jp', 'ne.jp',
			'com.cn', 'net.cn', 'org.cn', 'gov.cn',
			'com.hk', 'com.tw', 'com.sg', 'com.br',
		]);
		const lastTwo = parts.slice(-2).join('.');
		return twoLevelSuffixes.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
	} catch {
		return '';
	}
}

/**
 * Render a filename pattern such as "{date}-{title}" using the extracted page payload.
 */
function renderFilename(pattern, payload, now = new Date()) {
	const title = (payload && payload.title) || 'Untitled';
	const domain = getDomain((payload && payload.url) || '') || 'unknown';

	const replacements = {
		'{title}': title,
		'{domain}': domain,
		'{date}': formatDate(now),
		'{time}': formatTime(now),
	};

	let rendered = String(pattern === undefined || pattern === null ? '{title}' : pattern);
	for (const [token, value] of Object.entries(replacements)) {
		rendered = rendered.split(token).join(value);
	}

	return sanitizeFileName(rendered);
}

/**
 * Avoid overwriting an existing note: "Title.md" -> "Title 1.md".
 */
function uniquePath(target, exists = fs.existsSync) {
	if (!exists(target)) return target;

	const ext = path.extname(target);
	const base = ext ? target.slice(0, -ext.length) : target;
	for (let i = 1; i < 1000; i++) {
		const candidate = `${base} ${i}${ext}`;
		if (!exists(candidate)) return candidate;
	}

	throw new Error(`Could not find a free filename near: ${target}`);
}

function writeMarkdownFile(outputDir, fileStem, markdown) {
	fs.mkdirSync(outputDir, { recursive: true });
	const target = path.join(outputDir, `${sanitizeFileName(fileStem)}.md`);
	const outputPath = uniquePath(target);
	fs.writeFileSync(outputPath, markdown, 'utf8');
	return outputPath;
}

module.exports = {
	MAX_STEM_LENGTH,
	formatDate,
	formatTime,
	getDomain,
	renderFilename,
	sanitizeFileName,
	uniquePath,
	writeMarkdownFile,
};
