import { describe, expect, it } from 'vitest';

import faster from '../scripts/lib/media/faster-whisper.js';

const { bridgeArgs, pickBackend, pythonExecutable, resolveModel } = faster;

describe('resolveModel', () => {
	it('lets CLIP_FASTER_WHISPER_MODEL win over the flag', () => {
		expect(resolveModel('small', { env: { CLIP_FASTER_WHISPER_MODEL: 'D:/models/large-v3' } })).toBe(
			'D:/models/large-v3'
		);
	});

	it('keeps an absolute model path from --whisper-model', () => {
		expect(resolveModel('D:/models/turbo', { env: {} })).toBe('D:/models/turbo');
	});

	it('falls back to the plain name', () => {
		expect(resolveModel('medium', { env: {} })).toBe('medium');
		expect(resolveModel(undefined, { env: {} })).toBe('large-v3');
	});
});

describe('bridgeArgs', () => {
	it('converts the language code and defaults the device', () => {
		const args = bridgeArgs('model', 'audio.wav', 'out', { language: 'zh-Hans', env: {} });

		expect(args).toContain('--language');
		expect(args[args.indexOf('--language') + 1]).toBe('zh');
		expect(args[args.indexOf('--device') + 1]).toBe('auto');
		expect(args).not.toContain('--compute');
	});

	it('passes device, compute and beam through from the environment', () => {
		const args = bridgeArgs('model', 'audio.wav', 'out', {
			language: 'auto',
			threads: 4,
			env: {
				CLIP_FASTER_WHISPER_DEVICE: 'cpu',
				CLIP_FASTER_WHISPER_COMPUTE: 'int8',
				CLIP_FASTER_WHISPER_BEAM: '3',
			},
		});

		expect(args[args.indexOf('--device') + 1]).toBe('cpu');
		expect(args[args.indexOf('--compute') + 1]).toBe('int8');
		expect(args[args.indexOf('--beam') + 1]).toBe('3');
		expect(args[args.indexOf('--threads') + 1]).toBe('4');
	});
});

describe('pickBackend', () => {
	it('auto stays on whisper.cpp without a configured GPU model', () => {
		expect(pickBackend({ env: {} })).toBe('cpp');
	});

	it('auto prefers faster-whisper once a model is configured', () => {
		expect(pickBackend({ env: { CLIP_FASTER_WHISPER_MODEL: 'D:/models/turbo' } })).toBe('faster');
	});

	it('an explicit flag overrides auto detection', () => {
		expect(pickBackend({ whisperBackend: 'cpp', env: { CLIP_FASTER_WHISPER_MODEL: 'x' } })).toBe('cpp');
		expect(pickBackend({ whisperBackend: 'faster', env: {} })).toBe('faster');
	});
});

describe('pythonExecutable', () => {
	it('honours CLIP_PYTHON', () => {
		expect(pythonExecutable({ env: { CLIP_PYTHON: 'C:/py/python.exe' } })).toBe('C:/py/python.exe');
		expect(pythonExecutable({ env: {} })).toBe('python');
	});
});
