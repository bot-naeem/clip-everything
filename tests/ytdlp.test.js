import { describe, expect, it } from 'vitest';

import ytdlp from '../scripts/lib/media/ytdlp.js';

const { classifyFailure, failureToError, normalizeLang, playlistArgs } = ytdlp;

describe('normalizeLang', () => {
	it('drops the YouTube auto-caption hash', () => {
		expect(normalizeLang('en-j3PyPqV-e1s')).toBe('en');
		expect(normalizeLang('zh-Hans-abc123ABC-xy9')).toBe('zh-Hans');
	});

	it('keeps ordinary language codes untouched', () => {
		expect(normalizeLang('en-US')).toBe('en-US');
		expect(normalizeLang('zh-Hans')).toBe('zh-Hans');
		expect(normalizeLang('')).toBe('');
	});
});

const YOUTUBE = { url: 'https://www.youtube.com/watch?v=abc123' };

describe('classifyFailure', () => {
	it('detects the YouTube bot wall', () => {
		const result = classifyFailure('ERROR: [youtube] abc: Sign in to confirm you are not a bot');
		expect(result.code).toBe('auth_required');
	});

	it('detects app-bound cookie encryption', () => {
		const result = classifyFailure('ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927');
		expect(result.code).toBe('cookie_encrypted');
	});

	it('detects a locked browser cookie database', () => {
		const result = classifyFailure('ERROR: Could not copy Edge cookie database');
		expect(result.code).toBe('cookie_locked');
	});

	it('detects a missing JavaScript runtime', () => {
		const result = classifyFailure('ERROR: [youtube] abc: Requested format is not available.');
		expect(result.code).toBe('format_unavailable');
	});

	it('keeps unavailable videos separate', () => {
		expect(classifyFailure('ERROR: Video unavailable').code).toBe('unavailable');
	});
});

describe('failureToError', () => {
	it('prints a copy-paste login command for auth walls', () => {
		const error = failureToError('ERROR: Sign in to confirm you are not a bot', YOUTUBE);
		expect(error.message).toMatch(/npm run login -- --profile youtube/);
		expect(error.message).toMatch(/--login/);
	});

	it('derives a sensible profile for non-YouTube sites', () => {
		const error = failureToError('ERROR: Sign in to confirm', { url: 'https://www.bilibili.com/video/BV1xx' });
		expect(error.message).toMatch(/--profile bilibili/);
	});

	it('explains app-bound encryption instead of suggesting --cookies-from-browser', () => {
		const error = failureToError('ERROR: Failed to decrypt with DPAPI', YOUTUBE);
		expect(error.message).toMatch(/app-bound/);
		expect(error.message).toMatch(/npm run login/);
	});

	it('points at CLIP_JS_RUNTIME when formats are missing', () => {
		const error = failureToError('ERROR: Requested format is not available', YOUTUBE);
		expect(error.message).toMatch(/CLIP_JS_RUNTIME/);
	});
});

describe('playlistArgs', () => {
	const bin = 'yt-dlp';
	const options = { supports: () => true, env: {} };

	it('expands the whole playlist by default', () => {
		const args = playlistArgs(bin, options, 'https://www.youtube.com/playlist?list=PLabc');

		expect(args).toContain('--yes-playlist');
		expect(args).toContain('--flat-playlist');
		expect(args).not.toContain('--playlist-items');
		expect(args[args.length - 1]).toBe('https://www.youtube.com/playlist?list=PLabc');
	});

	it('keeps only the requested entry range', () => {
		const args = playlistArgs(bin, { ...options, playlistItems: '42-50' }, 'https://example.com/pl');

		expect(args).toContain('--playlist-items');
		expect(args[args.indexOf('--playlist-items') + 1]).toBe('42-50');
	});

	it('passes the proxy and cookies through', () => {
		const args = playlistArgs(
			bin,
			{ ...options, proxy: 'http://127.0.0.1:7890', cookiesFile: 'C:/cookies.txt' },
			'https://example.com/pl'
		);

		expect(args).toContain('--proxy');
		expect(args[args.indexOf('--proxy') + 1]).toBe('http://127.0.0.1:7890');
		expect(args).toContain('--cookies');
		expect(args[args.indexOf('--cookies') + 1]).toBe('C:/cookies.txt');
	});
});
