import { describe, expect, it } from 'vitest';

import naming from '../scripts/lib/naming.js';

const { getDomain, renderFilename, sanitizeFileName, uniquePath } = naming;

describe('sanitizeFileName', () => {
	it('removes characters that are illegal on Windows', () => {
		expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('abcdefghij');
	});

	it('collapses whitespace and trims', () => {
		expect(sanitizeFileName('  hello   world  ')).toBe('hello world');
	});

	it('drops trailing dots and spaces', () => {
		expect(sanitizeFileName('report...')).toBe('report');
		expect(sanitizeFileName('report   ')).toBe('report');
	});

	it('strips leading dots so files stay visible', () => {
		expect(sanitizeFileName('...hidden')).toBe('hidden');
	});

	it('escapes Windows reserved device names', () => {
		expect(sanitizeFileName('CON')).toBe('CON_');
		expect(sanitizeFileName('lpt1')).toBe('lpt1_');
	});

	it('falls back to Untitled for empty input', () => {
		expect(sanitizeFileName('')).toBe('Untitled');
		expect(sanitizeFileName('///')).toBe('Untitled');
		expect(sanitizeFileName(undefined)).toBe('Untitled');
	});

	it('caps the length at 120 characters', () => {
		expect(sanitizeFileName('x'.repeat(500))).toHaveLength(120);
	});

	it('removes zero-width characters', () => {
		expect(sanitizeFileName('a\u200Bb\uFEFFc')).toBe('abc');
	});
});

describe('renderFilename', () => {
	const now = new Date(2026, 2, 9, 8, 5, 7);

	it('replaces title, domain, date and time tokens', () => {
		const name = renderFilename('{date}-{time}-{domain}-{title}', { title: 'Hello', url: 'https://blog.example.com/post' }, now);
		expect(name).toBe('2026-03-09-08-05-07-example.com-Hello');
	});

	it('uses local time rather than UTC', () => {
		expect(renderFilename('{date}', { title: 'x', url: 'https://a.com' }, now)).toBe('2026-03-09');
	});

	it('sanitizes the rendered result', () => {
		const name = renderFilename('{title}', { title: 'a/b:c', url: 'https://a.com' }, now);
		expect(name).toBe('abc');
	});

	it('falls back gracefully with a bad url', () => {
		expect(renderFilename('{domain}-{title}', { title: 'T', url: 'not a url' }, now)).toBe('unknown-T');
	});
});

describe('uniquePath', () => {
	it('returns the original path when free', () => {
		expect(uniquePath('/notes/a.md', () => false)).toBe('/notes/a.md');
	});

	it('appends a counter when the file exists', () => {
		const taken = new Set(['/notes/a.md', '/notes/a 1.md']);
		expect(uniquePath('/notes/a.md', (p) => taken.has(p))).toBe('/notes/a 2.md');
	});
});

describe('getDomain', () => {
	it('returns the registrable domain', () => {
		expect(getDomain('https://blog.example.com/x')).toBe('example.com');
		expect(getDomain('https://www.zhihu.com/question/1')).toBe('zhihu.com');
	});

	it('handles two-level suffixes', () => {
		expect(getDomain('https://news.bbc.co.uk/a')).toBe('bbc.co.uk');
	});

	it('keeps localhost and ip addresses', () => {
		expect(getDomain('http://localhost:4096/x')).toBe('localhost');
		expect(getDomain('http://127.0.0.1:3000')).toBe('127.0.0.1');
	});

	it('returns an empty string for garbage', () => {
		expect(getDomain('nope')).toBe('');
	});
});
