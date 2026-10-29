import { describe, expect, it } from 'vitest';
import path from 'node:path';

import args from '../scripts/lib/args.js';

const { parseArgs, resolveProfileDir } = args;

const env = { cwd: process.cwd(), homedir: process.cwd() };
const url = 'https://example.com/article';

describe('parseArgs', () => {
	it('returns defaults', () => {
		const options = parseArgs([url], env);
		expect(options.url).toBe('https://example.com/article');
		expect(options.outputDir.endsWith('clips')).toBe(true);
		expect(options.filenamePattern).toBe('{title}');
		expect(options.wait).toBe('networkidle');
		expect(options.timeoutMs).toBe(30000);
		expect(options.frontmatter).toBe(true);
		expect(options.browser).toBe('auto');
		expect(options.headless).toBe(true);
		expect(options.persist).toBe(true);
	});

	it('resolves the profile directory under the home directory', () => {
		const options = parseArgs([url, '--profile', 'work'], env);
		expect(options.profileDir).toBe(path.join(env.homedir, '.clip-everything', 'profiles', 'work'));
	});

	it('accepts a custom output directory', () => {
		const options = parseArgs([url, '--output', 'notes'], env);
		expect(options.outputDir).toBe(path.join(env.cwd, 'notes'));
	});

	it('supports headed and browser selection', () => {
		const options = parseArgs([url, '--headed', '--browser', 'msedge'], env);
		expect(options.headless).toBe(false);
		expect(options.browser).toBe('msedge');
	});

	it('supports disabling frontmatter and persistence', () => {
		const options = parseArgs([url, '--no-frontmatter', '--no-persist'], env);
		expect(options.frontmatter).toBe(false);
		expect(options.persist).toBe(false);
	});

	it('rejects unknown flags', () => {
		expect(() => parseArgs([url, '--nope'], env)).toThrow(/Unknown argument/);
	});

	it('rejects invalid wait modes', () => {
		expect(() => parseArgs([url, '--wait', 'forever'], env)).toThrow(/Invalid --wait/);
	});

	it('rejects invalid timeouts', () => {
		expect(() => parseArgs([url, '--timeout-ms', '0'], env)).toThrow(/Invalid --timeout-ms/);
		expect(() => parseArgs([url, '--timeout-ms', 'abc'], env)).toThrow(/Invalid --timeout-ms/);
	});

	it('rejects invalid browsers', () => {
		expect(() => parseArgs([url, '--browser', 'safari'], env)).toThrow(/Invalid --browser/);
	});

	it('rejects non-http protocols', () => {
		expect(() => parseArgs(['file:///etc/passwd'], env)).toThrow(/Unsupported protocol/);
	});

	it('reports help and version without parsing a url', () => {
		expect(parseArgs(['--help'], env)).toEqual({ help: true });
		expect(parseArgs(['--version'], env)).toEqual({ version: true });
	});
});

describe('resolveProfileDir', () => {
	it('keeps profile names inside the profiles directory', () => {
		const dir = resolveProfileDir('../../etc', env.homedir);
		expect(dir).toBe(path.join(env.homedir, '.clip-everything', 'profiles', '....etc'));
	});

	it('falls back to default for empty names', () => {
		expect(resolveProfileDir('', env.homedir)).toBe(path.join(env.homedir, '.clip-everything', 'profiles', 'default'));
	});
});
