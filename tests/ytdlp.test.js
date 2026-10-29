import { describe, expect, it } from 'vitest';

import ytdlp from '../scripts/lib/media/ytdlp.js';

const { classifyFailure, failureToError } = ytdlp;

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
