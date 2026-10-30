import { describe, expect, it } from 'vitest';

import whisper from '../scripts/lib/media/whisper.js';

const { transcriptionTimeout, whisperLanguage } = whisper;

describe('transcriptionTimeout', () => {
	it('is never shorter than an hour, even for a short clip', () => {
		expect(transcriptionTimeout({ timeoutMs: 600000, duration: 60 })).toBe(3600000);
	});

	it('scales with audio duration for long lectures', () => {
		// 3 hour lecture: 8x realtime still finishes.
		expect(transcriptionTimeout({ timeoutMs: 600000, duration: 3 * 3600 })).toBe(3 * 3600 * 8 * 1000);
	});

	it('honours an explicit --whisper-timeout-ms', () => {
		expect(transcriptionTimeout({ whisperTimeoutMs: 7200000, duration: 5 * 3600 })).toBe(7200000);
	});

	it('ignores a missing duration', () => {
		expect(transcriptionTimeout({})).toBe(3600000);
	});
});

describe('whisperLanguage', () => {
	it('collapses region codes', () => {
		expect(whisperLanguage('zh-Hans')).toBe('zh');
		expect(whisperLanguage('en-US')).toBe('en');
	});

	it('keeps auto detection', () => {
		expect(whisperLanguage('auto')).toBe('auto');
		expect(whisperLanguage('')).toBe('auto');
	});
});
