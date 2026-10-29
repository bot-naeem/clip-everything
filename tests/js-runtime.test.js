import { describe, expect, it } from 'vitest';

import jsRuntime from '../scripts/lib/media/js-runtime.js';

const { jsRuntimeArgs, runtimeSpec } = jsRuntime;

describe('runtimeSpec', () => {
	it('defaults to the node executable that is running the CLI', () => {
		expect(runtimeSpec({}, 'C:/node/node.exe')).toBe('node:C:/node/node.exe');
	});

	it('can be disabled for custom yt-dlp setups', () => {
		expect(runtimeSpec({ CLIP_JS_RUNTIME: 'none' }, 'C:/node/node.exe')).toBeNull();
		expect(runtimeSpec({ CLIP_JS_RUNTIME: 'off' }, 'C:/node/node.exe')).toBeNull();
	});

	it('passes an explicit runtime through unchanged', () => {
		expect(runtimeSpec({ CLIP_JS_RUNTIME: 'deno' }, 'C:/node/node.exe')).toBe('deno');
		expect(runtimeSpec({ CLIP_JS_RUNTIME: 'node:C:/tools/node.exe' }, 'C:/node/node.exe')).toBe('node:C:/tools/node.exe');
	});
});

describe('jsRuntimeArgs', () => {
	it('hands yt-dlp the running node when it supports --js-runtimes', () => {
		const args = jsRuntimeArgs('yt-dlp', {
			env: {},
			execPath: 'C:/node/node.exe',
			supports: () => true,
		});
		expect(args).toEqual(['--js-runtimes', 'node:C:/node/node.exe']);
	});

	it('stays quiet on older yt-dlp builds that reject the flag', () => {
		const args = jsRuntimeArgs('yt-dlp', { env: {}, supports: () => false });
		expect(args).toEqual([]);
	});

	it('stays quiet when the runtime is disabled', () => {
		const args = jsRuntimeArgs('yt-dlp', {
			env: { CLIP_JS_RUNTIME: 'none' },
			supports: () => true,
		});
		expect(args).toEqual([]);
	});
});
