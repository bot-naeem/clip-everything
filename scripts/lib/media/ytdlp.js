'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { StageError } = require('../errors');
const { jsRuntimeArgs } = require('./js-runtime');
const { requireTool } = require('./tools');

const AUTH_WALL_RE = /sign in to confirm|not a bot|login_required|use --cookies/i;
const COOKIE_LOCK_RE = /could not copy (chrome|edge|firefox)? ?cookie database/i;
const COOKIE_ENCRYPTED_RE = /failed to decrypt with dpapi|app-bound encryption|could not decrypt/i;
const FORMAT_MISSING_RE = /requested format is not available|only images are available for download/i;
const UNAVAILABLE_RE = /video unavailable|private video|members-only|this video is unavailable|removed by the uploader|age-restricted/i;

function firstErrorLine(stderr) {
	const lines = String(stderr || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const error = lines.find((line) => /^ERROR:/i.test(line));
	return (error || lines[lines.length - 1] || '').replace(/^ERROR:\s*/i, '');
}

/**
 * Run a binary and buffer its output. yt-dlp reports progress on stderr, so
 * callers that care (audio download) get a line callback.
 */
function run(bin, args, options = {}) {
	const timeoutMs = options.timeoutMs || 600000;
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { windowsHide: true });
		const stdout = [];
		const stderr = [];
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill('SIGKILL');
			reject(new StageError('download', `command timed out after ${Math.round(timeoutMs / 1000)}s: ${path.basename(bin)}`));
		}, timeoutMs);

		child.stdout.on('data', (chunk) => stdout.push(chunk));
		child.stderr.on('data', (chunk) => {
			const text = chunk.toString();
			stderr.push(chunk);
			if (options.onStderr) options.onStderr(text);
		});

		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new StageError('start', `could not run ${path.basename(bin)}: ${error.message}`, error));
		});

		child.on('close', (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				code,
				stdout: Buffer.concat(stdout).toString('utf8'),
				stderr: Buffer.concat(stderr).toString('utf8'),
			});
		});
	});
}

function baseArgs(options = {}) {
	const args = [options.playlist ? '--yes-playlist' : '--no-playlist', '--no-warnings'];
	if (options.proxy) args.push('--proxy', options.proxy);
	if (options.cookiesFile) args.push('--cookies', options.cookiesFile);
	if (options.cookiesFromBrowser) args.push('--cookies-from-browser', options.cookiesFromBrowser);
	return args;
}

function shorten(text, max = 90) {
	const first = String(text || '')
		.replace(/\s+/g, ' ')
		.split(/(?<=\.)\s/)[0]
		.trim();
	return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

function suggestProfile(url) {
	let host = '';
	try {
		host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
	} catch {
		return 'default';
	}
	if (/^(youtu\.be|youtube\.com|m\.youtube\.com)$/.test(host)) return 'youtube';
	if (/^(b23\.tv|bilibili\.com|m\.bilibili\.com)$/.test(host)) return 'bilibili';
	if (/^(twitter\.com|x\.com)$/.test(host)) return 'x';
	return host.split('.')[0] || 'default';
}

function originOf(url) {
	try {
		return new URL(url).origin;
	} catch {
		return 'https://example.com';
	}
}

/** The exact command a user can copy to get past a login wall. */
function loginCommand(options = {}) {
	const profile = options.profile || suggestProfile(options.url);
	return `npm run login -- --profile ${profile} --url ${originOf(options.url)}`;
}

function classifyFailure(stderr) {
	const message = firstErrorLine(stderr);
	if (COOKIE_ENCRYPTED_RE.test(message)) {
		return { code: 'cookie_encrypted', message };
	}
	if (COOKIE_LOCK_RE.test(message)) {
		return { code: 'cookie_locked', message: 'the browser is running, so its cookie database is locked' };
	}
	if (FORMAT_MISSING_RE.test(message)) {
		return { code: 'format_unavailable', message };
	}
	if (AUTH_WALL_RE.test(message)) {
		return { code: 'auth_required', message };
	}
	if (UNAVAILABLE_RE.test(message)) {
		return { code: 'unavailable', message };
	}
	return { code: 'failed', message };
}

function failureToError(stderr, options = {}) {
	const { code, message } = classifyFailure(stderr);
	const login = loginCommand(options);

	if (code === 'auth_required') {
		const reason = /sign in to confirm[^.]*\.?/i.exec(message)?.[0] || shorten(message, 90);
		if (options.profile) {
			return new StageError(
				'download',
				`the site wants a signed-in session (${reason}). The saved session in profile ` +
					`"${options.profile}" may have expired. Run "${login}" to refresh it, or add --login.`
			);
		}
		return new StageError(
			'download',
			`the site wants a signed-in session (${reason}). ` +
				`Run "${login}" once, then retry with --profile ${suggestProfile(options.url)}. ` +
				'Tip: add --login to open that window automatically.'
		);
	}
	if (code === 'cookie_encrypted') {
		return new StageError(
			'download',
			'this browser encrypts cookies with an app-bound key, which yt-dlp cannot read. ' +
				`Use the login window instead: "${login}", then retry with --profile ` +
				`${options.profile || suggestProfile(options.url)} (or pass --login).`
		);
	}
	if (code === 'cookie_locked') {
		return new StageError(
			'download',
			`${message}. Close that browser completely and retry, or use "${login}" ` +
				'to export a cookies.txt without touching the browser database.'
		);
	}
	if (code === 'format_unavailable') {
		return new StageError(
			'download',
			'yt-dlp could not solve the site\'s JavaScript challenge, so no downloadable format was returned. ' +
				'ClipEverything passes the running Node executable automatically; if this persists, ' +
				'install Node 20+ or set CLIP_JS_RUNTIME=node:<path-to-node>.'
		);
	}
	if (code === 'unavailable') {
		return new StageError('download', `video is not available: ${message}`);
	}
	return new StageError('download', message || 'yt-dlp failed');
}

async function probe(url, options = {}) {
	const bin = requireTool('ytDlp', options);
	const args = [...baseArgs(options), ...jsRuntimeArgs(bin, options), '--skip-download', '-J', url];
	const result = await run(bin, args, { timeoutMs: options.timeoutMs });

	if (result.code !== 0) throw failureToError(result.stderr, options);

	try {
		return JSON.parse(result.stdout);
	} catch {
		throw new StageError('download', 'could not parse yt-dlp metadata (unexpected output)');
	}
}

/**
 * Flat playlist entries sometimes carry a full url, sometimes only an id.
 * Keep the extraction tolerant so a single odd entry does not kill the run.
 */
function entryUrl(entry) {
	if (!entry) return null;
	if (entry.webpage_url) return entry.webpage_url;
	if (entry.url && /^https?:/i.test(entry.url)) return entry.url;
	if (entry.id) {
		const key = String(entry.ie_key || entry.extractor_key || '').toLowerCase();
		if (key.includes('youtube')) return `https://www.youtube.com/watch?v=${entry.id}`;
	}
	return null;
}

/** Expand a playlist/channel URL into lightweight entries (no per-video probe). */
async function probePlaylist(url, options = {}) {
	const bin = requireTool('ytDlp', options);
	const args = [
		...baseArgs({ ...options, playlist: true }),
		...jsRuntimeArgs(bin, options),
		'--flat-playlist',
		'-J',
		url,
	];
	const result = await run(bin, args, { timeoutMs: options.timeoutMs });

	if (result.code !== 0) throw failureToError(result.stderr, options);

	try {
		return JSON.parse(result.stdout);
	} catch {
		throw new StageError('download', 'could not parse yt-dlp playlist metadata (unexpected output)');
	}
}

function languageMatches(available, wanted) {
	const target = String(wanted).toLowerCase();
	if (available === target) return true;
	const base = target.split('-')[0];
	return String(available).toLowerCase().split('-')[0] === base;
}

/**
 * Preference: manual track in a preferred language, then automatic track in a
 * preferred language, then the video's own automatic track. A manual English
 * track beats a machine-translated Chinese one.
 */
function pickSubtitleTrack(info, languages) {
	const manual = info.subtitles || {};
	const auto = info.automatic_captions || {};
	const wanted = languages && languages.length ? languages : ['zh-Hans', 'zh-CN', 'zh', 'en'];

	for (const lang of wanted) {
		const key = Object.keys(manual).find((name) => languageMatches(name, lang));
		if (key && manual[key].length) return { lang: key, automatic: false, formats: manual[key] };
	}

	for (const lang of wanted) {
		const key = Object.keys(auto).find((name) => languageMatches(name, lang));
		if (key && auto[key].length) return { lang: key, automatic: true, formats: auto[key] };
	}

	const original = info.language;
	if (original && auto[original] && auto[original].length) {
		return { lang: original, automatic: true, formats: auto[original] };
	}

	const anyManual = Object.keys(manual).find((key) => manual[key].length);
	if (anyManual) return { lang: anyManual, automatic: false, formats: manual[anyManual] };

	const anyAuto = Object.keys(auto).find((key) => auto[key].length);
	if (anyAuto) return { lang: anyAuto, automatic: true, formats: auto[anyAuto] };

	return null;
}

function preferredFormat(formats) {
	const extensions = (formats || []).map((format) => String(format.ext || ''));
	for (const wanted of ['json3', 'vtt', 'srv3', 'ttml']) {
		if (extensions.includes(wanted)) return wanted;
	}
	return extensions.find((ext) => ext && ext !== 'none') || 'vtt';
}

function listFiles(dir) {
	try {
		return fs.readdirSync(dir).map((name) => path.join(dir, name));
	} catch {
		return [];
	}
}

function sourceArgs(options, url) {
	// --load-info-json lets tests (and `--info-json` debugging) reuse a saved
	// metadata dump instead of re-extracting the page.
	return options.infoJson ? ['--load-info-json', options.infoJson] : [url];
}

async function downloadSubtitles(url, track, dir, options = {}) {
	const bin = requireTool('ytDlp', options);
	fs.mkdirSync(dir, { recursive: true });

	const format = preferredFormat(track.formats);
	const args = [
		...baseArgs(options),
		...jsRuntimeArgs(bin, options),
		'--skip-download',
		track.automatic ? '--write-auto-subs' : '--write-subs',
		'--sub-langs',
		track.lang,
		'--sub-format',
		format,
		'-o',
		path.join(dir, '%(id)s.%(ext)s'),
		...sourceArgs(options, url),
	];

	const result = await run(bin, args, { timeoutMs: options.timeoutMs });
	if (result.code !== 0) throw failureToError(result.stderr, options);

	const files = listFiles(dir).filter((file) => !/\.(part|ytdl)$/.test(file));
	const match =
		files.find((file) => file.endsWith(`.${track.lang}.${format}`)) ||
		files.find((file) => file.includes(`.${track.lang}.`)) ||
		files[0];

	if (!match) {
		throw new StageError('download', 'yt-dlp reported success but no subtitle file was written');
	}

	return { file: match, format };
}

async function downloadAudio(url, dir, options = {}) {
	const bin = requireTool('ytDlp', options);
	fs.mkdirSync(dir, { recursive: true });

	const target = path.join(dir, 'audio.%(ext)s');
	const args = [
		...baseArgs(options),
		...jsRuntimeArgs(bin, options),
		'-f',
		'bestaudio[ext=m4a]/bestaudio/best',
		'-o',
		target,
		'--newline',
		...sourceArgs(options, url),
	];

	const result = await run(bin, args, {
		timeoutMs: options.timeoutMs,
		onStderr: options.onProgress
			? (text) => {
					const match = /\[download\]\s+([\d.]+)%/.exec(text);
					if (match) options.onProgress(Number(match[1]));
				}
			: undefined,
	});
	if (result.code !== 0) throw failureToError(result.stderr, options);

	const audio = listFiles(dir).find((file) => /^audio\.(m4a|webm|opus|mp3|wav|aac|ogg|flac)$/i.test(path.basename(file)));
	if (!audio) throw new StageError('download', 'yt-dlp reported success but no audio file was written');
	return audio;
}

module.exports = {
	baseArgs,
	classifyFailure,
	downloadAudio,
	downloadSubtitles,
	entryUrl,
	failureToError,
	languageMatches,
	pickSubtitleTrack,
	preferredFormat,
	probe,
	probePlaylist,
	run,
};
