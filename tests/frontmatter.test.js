import { describe, expect, it } from 'vitest';

import frontmatter from '../scripts/lib/frontmatter.js';

const { buildFrontmatter, yamlString } = frontmatter;

const now = new Date('2026-03-09T08:05:07.000Z');

function payload(overrides = {}) {
	return {
		title: 'A title',
		url: 'https://example.com/post',
		author: 'Someone',
		site: 'Example',
		published: '2026-03-01',
		description: 'A description',
		...overrides,
	};
}

describe('yamlString', () => {
	it('quotes plain values', () => {
		expect(yamlString('hello')).toBe('"hello"');
	});

	it('escapes quotes and backslashes', () => {
		expect(yamlString('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
	});

	it('keeps newlines escaped so the block stays valid', () => {
		expect(yamlString('line1\nline2')).toBe('"line1\\nline2"');
	});

	it('handles empty values', () => {
		expect(yamlString('')).toBe('""');
		expect(yamlString(undefined)).toBe('""');
	});
});

describe('buildFrontmatter', () => {
	it('emits a fenced block with the documented fields', () => {
		const block = buildFrontmatter(payload(), now);
		const lines = block.trim().split('\n');
		expect(lines[0]).toBe('---');
		expect(lines[lines.length - 1]).toBe('---');
		expect(block).toContain('title: "A title"');
		expect(block).toContain('source: "https://example.com/post"');
		expect(block).toContain('author: "Someone"');
		expect(block).toContain('site: "Example"');
		expect(block).toContain('published: "2026-03-01"');
		expect(block).toContain('description: "A description"');
		expect(block).toContain('clipped_at: "2026-03-09T08:05:07.000Z"');
	});

	it('survives titles containing quotes', () => {
		const block = buildFrontmatter(payload({ title: 'He said "stop"' }), now);
		expect(block).toContain('title: "He said \\"stop\\""');
	});
});
