import { describe, expect, it } from 'vitest';

import markdown from '../scripts/lib/markdown.js';
import browser from '../scripts/lib/browser.js';
import sites from '../scripts/lib/sites.js';

const { convertToMarkdown, trimZhihuArticleTail } = markdown;
const { resolveAttempts } = browser;
const { findHandler } = sites;

describe('convertToMarkdown', () => {
	it('converts headings and paragraphs', () => {
		const md = convertToMarkdown('<h2>Title</h2><p>Hello <strong>world</strong></p>');
		expect(md).toContain('## Title');
		expect(md).toContain('**world**');
	});

	it('converts tables via GFM', () => {
		const md = convertToMarkdown('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
		expect(md).toMatch(/\|\s*A\s*\|\s*B\s*\|/);
	});

	it('strips scripts and styles', () => {
		const md = convertToMarkdown('<style>p{}</style><script>1</script><p>Keep</p>');
		expect(md).toBe('Keep');
	});

	it('falls back to text when html is empty', () => {
		expect(convertToMarkdown('', 'plain text')).toBe('plain text');
	});
});

describe('trimZhihuArticleTail', () => {
	const url = 'https://zhuanlan.zhihu.com/p/123';

	it('cuts trailing Zhihu UI noise', () => {
		const md = 'Body line\n\n编辑于 2026-03-01\n所属专栏 · 测试';
		expect(trimZhihuArticleTail(md, url).trimEnd()).toBe('Body line');
	});

	it('leaves other hosts untouched', () => {
		const md = 'Body\n\n编辑于 2026-03-01';
		expect(trimZhihuArticleTail(md, 'https://example.com/x')).toBe(md);
	});

	it('does nothing when no marker exists', () => {
		const md = 'Body\n\nMore body';
		expect(trimZhihuArticleTail(md, url)).toBe(md);
	});
});

describe('findHandler', () => {
	it('detects Zhihu answers', () => {
		expect(findHandler('https://www.zhihu.com/question/1/answer/2').id).toBe('zhihu-answer');
	});

	it('detects Zhihu zhuanlan posts', () => {
		expect(findHandler('https://zhuanlan.zhihu.com/p/123').id).toBe('zhihu-zhuanlan');
	});

	it('detects X status pages', () => {
		expect(findHandler('https://x.com/user/status/123').id).toBe('x-status');
	});

	it('returns null for generic sites', () => {
		expect(findHandler('https://example.com/post')).toBeNull();
	});
});

describe('resolveAttempts', () => {
	it('honours an explicit browser', () => {
		expect(resolveAttempts('chrome')).toEqual(['chrome']);
	});

	it('offers every channel when auto', () => {
		const attempts = resolveAttempts('auto');
		expect(attempts).toContain('chromium');
		expect(attempts).toHaveLength(3);
	});
});
