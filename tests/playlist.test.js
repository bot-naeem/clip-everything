import { describe, expect, it } from 'vitest';

import ytdlp from '../scripts/lib/media/ytdlp.js';
import transcribe from '../scripts/transcribe.js';

const { baseArgs, entryUrl } = ytdlp;
const { renderPlaylistIndex } = transcribe;

describe('playlist args', () => {
	it('switches yt-dlp to playlist mode only when asked', () => {
		expect(baseArgs({ playlist: true })).toContain('--yes-playlist');
		expect(baseArgs({})).toContain('--no-playlist');
		expect(baseArgs({})).not.toContain('--yes-playlist');
	});
});

describe('entryUrl', () => {
	it('prefers a full webpage_url', () => {
		expect(entryUrl({ webpage_url: 'https://example.com/v/1' })).toBe('https://example.com/v/1');
	});

	it('keeps an absolute url', () => {
		expect(entryUrl({ url: 'https://www.youtube.com/watch?v=abc' })).toBe('https://www.youtube.com/watch?v=abc');
	});

	it('builds a YouTube watch url from a bare id', () => {
		expect(entryUrl({ id: 'abc123', ie_key: 'Youtube' })).toBe('https://www.youtube.com/watch?v=abc123');
	});

	it('returns null when the entry has nothing usable', () => {
		expect(entryUrl({ title: 'no id' })).toBeNull();
		expect(entryUrl(null)).toBeNull();
	});
});

describe('mapPool', () => {
	const { mapPool } = transcribe;

	it('keeps results in input order even when tasks finish out of order', async () => {
		const delays = [60, 10, 30, 5];
		const out = await mapPool(4, 2, async (index) => {
			await new Promise((resolve) => setTimeout(resolve, delays[index]));
			return index * 10;
		});

		expect(out).toEqual([0, 10, 20, 30]);
	});

	it('never runs more tasks than requested', async () => {
		let inFlight = 0;
		let peak = 0;
		await mapPool(6, 3, async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 10));
			inFlight--;
		});

		expect(peak).toBe(3);
	});

	it('serialises when jobs is 1', async () => {
		const order = [];
		await mapPool(3, 1, async (index) => {
			order.push(index);
		});

		expect(order).toEqual([0, 1, 2]);
	});

	it('propagates a task rejection', async () => {
		await expect(
			mapPool(2, 2, async (index) => {
				if (index === 1) throw new Error('boom');
				return index;
			})
		).rejects.toThrow('boom');
	});
});

describe('renderPlaylistIndex', () => {
	const list = { title: 'Reasoning Course', webpage_url: 'https://example.com/playlist' };

	it('lists every transcript with duration and a relative link', () => {
		const markdown = renderPlaylistIndex(list, [
			{ title: 'One', outputPath: 'C:/out/One.md', duration: '10:00' },
			{ title: 'Two', outputPath: 'C:/out/Two.md', duration: '20:00' },
		]);

		expect(markdown).toContain('# Reasoning Course');
		expect(markdown).toContain('共 2 讲');
		expect(markdown).toContain('| 1 | One | 10:00 | [One.md](<One.md>) |');
		expect(markdown).toContain('| 2 | Two | 20:00 | [Two.md](<Two.md>) |');
	});

	it('escapes pipes and records failures', () => {
		const markdown = renderPlaylistIndex(
			list,
			[{ title: 'A | B', outputPath: 'C:/out/AB.md', duration: '1:00' }],
			[{ title: 'Broken', error: 'download failed' }]
		);

		expect(markdown).toContain('A \\| B');
		expect(markdown).toContain('## 失败');
		expect(markdown).toContain('Broken — download failed');
	});
});
