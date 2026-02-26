#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
	const args = { file: '', url: '' };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--file') {
			args.file = argv[++i] || '';
			continue;
		}
		if (arg === '--url') {
			args.url = argv[++i] || '';
			continue;
		}
	}
	if (!args.file) {
		throw new Error('Usage: node scripts/zhihu-quality-check.js --file <path> [--url <page_url>]');
	}
	return args;
}

function fail(errors) {
	console.error(JSON.stringify({ ok: false, errors }, null, 2));
	process.exit(1);
}

function checkCommon(md, errors) {
	if (!md || md.trim().length < 1200) {
		errors.push('markdown_too_short');
	}
	if (md.includes('Partial conversion completed with errors.')) {
		errors.push('partial_conversion_error_marker');
	}
	if (/www\.w3\.org\/2000\/svg/i.test(md)) {
		errors.push('malformed_svg_image_url');
	}
	if (/^#\s*Untitled\s*$/m.test(md)) {
		errors.push('untitled_heading');
	}
}

function checkZhuanlan(md, errors) {
	const noiseMarkers = [
		'还没有人送礼物',
		'所属专栏',
		'最热内容 ·',
		'篇内容 ·',
		'100+热议'
	];
	for (const marker of noiseMarkers) {
		if (md.includes(marker)) errors.push(`noise_marker:${marker}`);
	}
	const blocks = md.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
	if (blocks.length < 16) {
		errors.push('too_few_paragraph_blocks');
	}
}

function checkAnswer(md, errors) {
	if (/\n目录\s*\n收起\b/.test(md) || /\b目录\b/.test(md) && /\b收起\b/.test(md)) {
		errors.push('catalog_ui_noise');
	}
	const blocks = md.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
	if (blocks.length < 12) {
		errors.push('too_few_paragraph_blocks');
	}
}

function getSourceUrlFromFrontmatter(md) {
	const m = String(md || '').match(/^---[\s\S]*?\nsource:\s*"([^"]+)"[\s\S]*?\n---/m);
	return m ? m[1] : '';
}

function detectTypeFromUrl(url) {
	const raw = String(url || '').trim();
	if (!raw) return '';
	let u;
	try {
		u = new URL(raw);
	} catch {
		return '';
	}
	const host = u.hostname || '';
	const pathname = u.pathname || '';
	if (/(^|\.)zhuanlan\.zhihu\.com$/.test(host) && /\/p\//.test(pathname)) return 'zhuanlan';
	if (/(^|\.)zhihu\.com$/.test(host) && /\/question\//.test(pathname)) return 'answer';
	return '';
}

function main() {
	const { file, url } = parseArgs(process.argv.slice(2));
	const abs = path.resolve(file);
	if (!fs.existsSync(abs)) {
		throw new Error(`File not found: ${abs}`);
	}
	const md = fs.readFileSync(abs, 'utf8');
	const detectedUrl = url || getSourceUrlFromFrontmatter(md);
	const type = detectTypeFromUrl(detectedUrl);
	if (!type) {
		throw new Error(`Unable to detect Zhihu page type from URL: ${detectedUrl || '(empty)'}`);
	}
	const errors = [];
	checkCommon(md, errors);
	if (type === 'zhuanlan') checkZhuanlan(md, errors);
	if (type === 'answer') checkAnswer(md, errors);
	if (errors.length > 0) fail(errors);
	console.log(JSON.stringify({ ok: true, file: abs, type }, null, 2));
}

main();
