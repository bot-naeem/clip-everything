import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import videoArgs from '../scripts/lib/video-args.js';
import ytdlp from '../scripts/lib/media/ytdlp.js';
import login from '../scripts/login.js';

const { parseVideoArgs } = videoArgs;
const { languageMatches, pickSubtitleTrack, preferredFormat } = ytdlp;
const { toNetscape } = login;

const env = { cwd: path.resolve('C:/work'), homedir: path.resolve('C:/home/user') };
const URL = 'https://www.youtube.com/watch?v=abc123';

describe('parseVideoArgs', () => {
	it('accepts the url after --video', () => {
		const options = parseVideoArgs(['--video', URL], env);
		expect(options.mode).toBe('video');
		expect(options.url).toBe(URL);
	});

	it('accepts a bare url', () => {
		expect(parseVideoArgs([URL], env).url).toBe(URL);
	});

	it('has sensible defaults', () => {
		const options = parseVideoArgs([URL], env);
		expect(options.whisperModel).toBe('small');
		expect(options.whisper).toBe(true);
		expect(options.forceWhisper).toBe(false);
		expect(options.languages).toEqual(['zh-Hans', 'zh-CN', 'zh', 'en']);
		expect(options.languageExplicit).toBe(false);
		expect(options.frontmatter).toBe(true);
		expect(options.outputDir).toBe(path.resolve('C:/work', 'clips'));
	});

	it('parses language preferences', () => {
		const options = parseVideoArgs([URL, '--lang', 'en, zh-Hans'], env);
		expect(options.languages).toEqual(['en', 'zh-Hans']);
		expect(options.languageExplicit).toBe(true);
	});

	it('parses a separate speech-to-text timeout', () => {
		const options = parseVideoArgs([URL, '--whisper-timeout-ms', '5400000'], env);
		expect(options.whisperTimeoutMs).toBe(5400000);
		expect(options.timeoutMs).toBe(600000);
	});

	it('rejects an unknown whisper backend', () => {
		expect(() => parseVideoArgs([URL, '--whisper-backend', 'magic'], env)).toThrow();
	});

	it('rejects a zero speech-to-text timeout', () => {
		expect(() => parseVideoArgs([URL, '--whisper-timeout-ms', '0'], env)).toThrow();
	});

	it('lets --whisper-model beat the model from config.json', () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-args-'));
		fs.mkdirSync(path.join(home, '.clip-everything'), { recursive: true });
		fs.writeFileSync(
			path.join(home, '.clip-everything', 'config.json'),
			JSON.stringify({ whisper: { backend: 'faster', model: 'D:/models/turbo' } })
		);

		const withConfig = parseVideoArgs([URL], { ...env, homedir: home });
		expect(withConfig.whisperBackend).toBe('faster');
		expect(withConfig.whisperModelFile).toBe('D:/models/turbo');

		const explicit = parseVideoArgs([URL, '--whisper-model', 'D:/models/large-v3'], { ...env, homedir: home });
		expect(explicit.whisperModelFile).toBeNull();
		expect(explicit.whisperModel).toBe('D:/models/large-v3');
	});

	it('handles whisper and proxy switches', () => {
		const options = parseVideoArgs([URL, '--no-whisper', '--no-proxy', '--save-srt', '--keep-audio'], env);
		expect(options.whisper).toBe(false);
		expect(options.proxy).toBeNull();
		expect(options.saveSrt).toBe(true);
		expect(options.keepAudio).toBe(true);
	});

	it('honours proxy environment variables', () => {
		const options = parseVideoArgs([URL], { ...env, HTTPS_PROXY: 'http://127.0.0.1:7890' });
		expect(options.proxy).toBe('http://127.0.0.1:7890');
	});

	it('rejects a missing or invalid url', () => {
		expect(() => parseVideoArgs([], env)).toThrow(/Missing <url>/);
		expect(() => parseVideoArgs(['not-a-url'], env)).toThrow(/Invalid URL/);
		expect(() => parseVideoArgs(['ftp://example.com/a.mp4'], env)).toThrow(/Unsupported protocol/);
	});

	it('rejects unknown flags', () => {
		expect(() => parseVideoArgs([URL, '--nope'], env)).toThrow(/Unknown argument/);
	});
});

describe('--profile cookie export', () => {
	const makeHome = () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-home-'));
		const dir = path.join(home, '.clip-everything', 'profiles', 'youtube');
		fs.mkdirSync(dir, { recursive: true });
		return { home, dir };
	};

	it('points yt-dlp at the cookies.txt written by login', () => {
		const { home, dir } = makeHome();
		fs.writeFileSync(path.join(dir, 'cookies.txt'), '# Netscape HTTP Cookie File\n');
		const options = parseVideoArgs([URL, '--profile', 'youtube'], { cwd: env.cwd, homedir: home });
		expect(options.cookiesFile).toBe(path.join(dir, 'cookies.txt'));
	});

	it('explains how to create the file when it is missing', () => {
		const { home } = makeHome();
		expect(() => parseVideoArgs([URL, '--profile', 'youtube'], { cwd: env.cwd, homedir: home })).toThrow(/npm run login/);
	});

	it('derives a per-site profile when --login is used', () => {
		const { home } = makeHome();
		const options = parseVideoArgs([URL, '--login'], { cwd: env.cwd, homedir: home });
		expect(options.login).toBe(true);
		expect(options.profile).toBe('youtube');
	});

	it('lets --login create a missing profile instead of failing', () => {
		const { home } = makeHome();
		const options = parseVideoArgs([URL, '--profile', 'youtube', '--login'], { cwd: env.cwd, homedir: home });
		expect(options.cookiesFile).toBeNull();
		expect(options.profile).toBe('youtube');
	});
});

describe('defaultProfileFor', () => {
	it('maps common video hosts to short profile names', () => {
		expect(videoArgs.defaultProfileFor('https://youtu.be/abc')).toBe('youtube');
		expect(videoArgs.defaultProfileFor('https://www.youtube.com/watch?v=abc')).toBe('youtube');
		expect(videoArgs.defaultProfileFor('https://www.bilibili.com/video/BV1xx')).toBe('bilibili');
		expect(videoArgs.defaultProfileFor('https://x.com/user/status/1')).toBe('x');
		expect(videoArgs.defaultProfileFor('https://vimeo.com/123')).toBe('vimeo');
	});
});

describe('toNetscape', () => {
	it('writes the tab-separated format yt-dlp expects', () => {
		const text = toNetscape([
			{ domain: '.youtube.com', path: '/', secure: true, expires: 1800000000, name: 'SID', value: 'abc' },
			{ domain: 'example.com', path: '/', secure: false, expires: -1, name: 'session', value: 'x' },
		]);
		expect(text).toContain('# Netscape HTTP Cookie File');
		expect(text).toContain('.youtube.com\tTRUE\t/\tTRUE\t1800000000\tSID\tabc');
		expect(text).toContain('example.com\tFALSE\t/\tFALSE\t0\tsession\tx');
	});
});

describe('pickSubtitleTrack', () => {	const info = {
		language: 'en',
		subtitles: { en: [{ ext: 'vtt' }] },
		automatic_captions: { en: [{ ext: 'json3' }], 'zh-Hans': [{ ext: 'json3' }] },
	};

	it('prefers a manual track over an automatic one', () => {
		const track = pickSubtitleTrack(info, ['en']);
		expect(track).toMatchObject({ lang: 'en', automatic: false });
	});

	it('matches regional variants by base language', () => {
		expect(languageMatches('zh-Hans', 'zh-CN')).toBe(true);
		expect(languageMatches('en-US', 'en')).toBe(true);
		expect(languageMatches('de', 'en')).toBe(false);
	});

	it('falls back to automatic captions', () => {
		const track = pickSubtitleTrack({ automatic_captions: { 'zh-Hans': [{ ext: 'json3' }] } }, ['zh-Hans']);
		expect(track).toMatchObject({ lang: 'zh-Hans', automatic: true });
	});

	it('falls back to the video language when the preference misses', () => {
		const track = pickSubtitleTrack({ language: 'de', automatic_captions: { de: [{ ext: 'vtt' }] } }, ['fr']);
		expect(track.lang).toBe('de');
	});

	it('returns null when there are no captions', () => {
		expect(pickSubtitleTrack({}, ['en'])).toBeNull();
	});
});

describe('preferredFormat', () => {
	it('prefers json3, then vtt', () => {
		expect(preferredFormat([{ ext: 'vtt' }, { ext: 'json3' }])).toBe('json3');
		expect(preferredFormat([{ ext: 'vtt' }, { ext: 'srv3' }])).toBe('vtt');
		expect(preferredFormat([])).toBe('vtt');
	});
});
