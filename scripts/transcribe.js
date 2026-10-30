#!/usr/bin/env node
'use strict';

/**
 * Video -> Markdown.
 *
 * Two routes, in order of preference:
 *   1. the video already has captions (manual or auto) -> yt-dlp downloads them
 *   2. no captions -> yt-dlp downloads the audio, ffmpeg normalises it and
 *      whisper.cpp transcribes it
 *
 * Both routes end in the same subtitle parser, so the note always has
 * timestamps, de-duplicated rolling captions and readable paragraphs.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { StageError } = require('./lib/errors');
const { buildVideoFrontmatter } = require('./lib/frontmatter');
const { getDomain, renderFilename, uniquePath, writeMarkdownFile } = require('./lib/naming');
const { resolveProfileDir } = require('./lib/args');
const fasterWhisper = require('./lib/media/faster-whisper');
const subtitles = require('./lib/media/subtitles');
const whisper = require('./lib/media/whisper');
const ytdlp = require('./lib/media/ytdlp');
const { defaultProfileFor, parseVideoArgs, resolveProxy, USAGE } = require('./lib/video-args');

const pkg = require('../package.json');

function describeError(error) {
	if (!error) return 'unknown error';
	const message = error instanceof Error ? error.message : String(error);
	return message.split('\n')[0];
}

function siteLabel(info) {
	const key = String(info.extractor_key || info.extractor || '');
	if (/youtube/i.test(key)) return 'YouTube';
	if (/bilibili/i.test(key)) return 'Bilibili';
	if (/vimeo/i.test(key)) return 'Vimeo';
	if (/twitter/i.test(key)) return 'X';
	return key || getDomain(info.webpage_url || '');
}

function publishedDate(info) {
	const raw = String(info.upload_date || info.release_date || '');
	if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
	return '';
}

function descriptionSnippet(description) {
	const junk = /^(?:[-–—_.·\s]*|n\/?a|none|无|暂无)$/i;
	const text = String(description || '')
		.replace(/\r/g, '')
		.split('\n')
		.map((line) => line.trim())
		.find((line) => line && !/^https?:\/\//.test(line));
	if (!text || junk.test(text)) return '';
	return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function transcriptLabel(source) {
	if (!source) return '';
	if (source.kind === 'whisper') {
		const engine =
			source.backend === 'faster-whisper'
				? `Whisper ${source.model} (faster-whisper${source.device ? `, ${source.device}` : ''})`
				: `Whisper ${source.model}`;
		const language = source.language && source.language !== 'auto' ? ` (${source.language})` : '';
		return `${engine} transcript${language}`;
	}
	const kind = source.automatic ? 'auto captions' : 'captions';
	return `${kind} (${source.language})`;
}

function buildMarkdown(info, options, transcript) {
	const title = String(info.title || 'Untitled video').trim();
	const durationSec = Number(info.duration || 0);
	const forceHours = durationSec >= 3600;

	const payload = {
		title,
		url: info.webpage_url || options.url,
		author: info.uploader || info.channel || '',
		site: siteLabel(info),
		published: publishedDate(info),
		description: descriptionSnippet(info.description),
	};

	const meta = {
		duration: durationSec ? subtitles.formatTimestamp(durationSec, forceHours) : '',
		language: transcript.language || '',
		transcript: transcriptLabel(transcript.source),
	};

	const header = [payload.author, meta.duration, meta.transcript].filter(Boolean).join(' · ');
	const lines = [`# ${title}`, ''];

	if (header) lines.push(`> ${header}`);
	lines.push(`> ${payload.url}`, '');

	const chapters = Array.isArray(info.chapters) ? info.chapters : [];
	if (chapters.length) {
		lines.push('## Chapters', '');
		for (const chapter of chapters) {
			const start = Number(chapter.start_time || 0);
			lines.push(`- [${subtitles.formatTimestamp(start, forceHours)}] ${String(chapter.title || '').trim()}`);
		}
		lines.push('');
	}

	lines.push('## Transcript', '', transcript.body, '');

	const markdown = (options.frontmatter ? buildVideoFrontmatter(payload, meta) : '') + lines.join('\n');
	return { markdown, payload, meta };
}

function shorten(text, max = 110) {
	const first = String(text || '')
		.replace(/\s+/g, ' ')
		.split(/(?<=\.)\s/)[0]
		.trim();
	return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Profile directories for the browsers yt-dlp can read cookies from. */
function browserDataDir(browser) {
	const home = os.homedir();
	const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
	const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

	if (process.platform === 'win32') {
		const dirs = {
			edge: path.join(local, 'Microsoft', 'Edge', 'User Data'),
			chrome: path.join(local, 'Google', 'Chrome', 'User Data'),
			brave: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
			firefox: path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'),
		};
		return dirs[browser] || null;
	}
	if (process.platform === 'darwin') {
		const base = path.join(home, 'Library', 'Application Support');
		const dirs = {
			edge: path.join(base, 'Microsoft Edge'),
			chrome: path.join(base, 'Google', 'Chrome'),
			brave: path.join(base, 'BraveSoftware', 'Brave-Browser'),
			firefox: path.join(base, 'Firefox', 'Profiles'),
			safari: path.join(home, 'Library', 'Cookies'),
		};
		return dirs[browser] || null;
	}
	const dirs = {
		chrome: path.join(home, '.config', 'google-chrome'),
		chromium: path.join(home, '.config', 'chromium'),
		brave: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'),
		firefox: path.join(home, '.mozilla', 'firefox'),
	};
	return dirs[browser] || null;
}

function installedBrowsers() {
	const candidates = process.platform === 'win32' ? ['edge', 'chrome', 'brave', 'firefox'] : ['chrome', 'chromium', 'brave', 'firefox', 'safari'];
	return candidates.filter((browser) => {
		const dir = browserDataDir(browser);
		return dir && fs.existsSync(dir);
	});
}

/**
 * `--login` opens the same visible window as `npm run login`, for the video's
 * own origin, and waits for it to close. That keeps the "one command" path
 * working on sites that block anonymous requests (YouTube in particular).
 */
function runLoginWindow(profile, origin) {
	const script = path.join(__dirname, 'login.js');
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [script, '--profile', profile, '--url', origin], { stdio: 'inherit' });
		child.once('error', reject);
		child.once('close', (code) => {
			if (code === 0) resolve();
			else reject(new StageError('login', `the login window exited with code ${code}`));
		});
	});
}

const YOUTUBE_AUTH_COOKIES = /^(SID|HSID|SSID|SAPISID|LOGIN_INFO|__Secure-1PSID|__Secure-3PSID)$/;

/** A cookies.txt can exist and still be anonymous — that is what bit us on YouTube. */
function looksSignedIn(file, origin) {
	try {
		const text = fs.readFileSync(file, 'utf8');
		if (!/youtube\.com|google\.com/i.test(origin)) return true;
		return text
			.split(/\r?\n/)
			.filter((line) => line && !line.startsWith('#'))
			.some((line) => YOUTUBE_AUTH_COOKIES.test(line.split('\t')[5] || ''));
	} catch {
		return false;
	}
}

async function ensureLogin(options, log) {
	if (!options.login) return;

	const origin = new URL(options.url).origin;
	const profile = options.profile || defaultProfileFor(options.url);
	log(`opening a browser to sign in for ${origin} (profile: ${profile})`);
	await runLoginWindow(profile, origin);

	const cookies = path.join(resolveProfileDir(profile), 'cookies.txt');
	if (!fs.existsSync(cookies)) {
		throw new StageError('login', 'the login window closed but no cookies.txt was written');
	}
	if (!looksSignedIn(cookies, origin)) {
		throw new StageError(
			'login',
			'the login window closed, but no signed-in session was found (only anonymous cookies). ' +
				'Run with --login again and finish the Google sign-in before closing the window.'
		);
	}
	options.profile = profile;
	options.cookiesFile = cookies;
	log(`session saved: ${cookies}`);
}

/**
 * Anonymous requests from datacenter/proxy IPs hit YouTube's bot wall. When that
 * happens, retry with cookies from an installed browser before giving up.
 */
async function probeWithAuth(options, warn) {
	try {
		const info = await ytdlp.probe(options.url, options);
		return { info, auth: {} };
	} catch (error) {
		const explicit = options.cookiesFromBrowser || options.cookiesFile;
		const recoverable = /wants a signed-in session|locked|decrypt|app-bound/i.test(error.message || '');
		if (explicit || !recoverable) throw error;

		const failures = [];
		for (const browser of installedBrowsers()) {
			try {
				const info = await ytdlp.probe(options.url, { ...options, cookiesFromBrowser: browser });
				warn('cookies', `used cookies from ${browser} to pass the login wall`);
				return { info, auth: { cookiesFromBrowser: browser } };
			} catch (retryError) {
				failures.push(`${browser}: ${shorten(describeError(retryError))}`);
			}
		}

		// Keep the original (useful) reason instead of the last retry's noise.
		if (failures.length) {
			error.message += ` Tried cookies from ${failures.join('; ')}.`;
		}
		throw error;
	}
}

/**
 * Long downloads and long transcriptions are otherwise silent for minutes;
 * print a line every 10%.
 */
function progressLogger(log, label, step = 10) {
	let last = -step;
	return (percent) => {
		if (percent < last + step && percent !== 100) return;
		last = percent;
		log(`${label}: ${percent}%`);
	};
}

async function collectTranscript(options, info, auth, tmpDir, warn, log) {
	const active = { ...options, ...auth };
	let cues = [];
	let source = null;
	let language = null;

	const track = options.forceWhisper ? null : ytdlp.pickSubtitleTrack(info, options.languages);

	if (track) {
		log(`downloading subtitles: ${track.lang}${track.automatic ? ' (auto-generated)' : ''}`);
		const downloaded = await ytdlp.downloadSubtitles(options.url, track, tmpDir, active);
		const raw = fs.readFileSync(downloaded.file, 'utf8');
		cues = subtitles.normalizeCues(subtitles.parseSubtitles(raw, downloaded.file));
		language = track.lang;
		source = { kind: 'subtitles', automatic: track.automatic, language: track.lang };

		if (!cues.length) warn('empty_subtitles', 'the subtitle file contained no usable cues');
	}

	if (!cues.length) {
		if (!options.whisper) {
			throw new StageError('transcribe', 'no usable subtitles and --no-whisper was given');
		}

		warn(
			'no_subtitles',
			options.forceWhisper ? 'speech-to-text forced' : 'no captions on this video, falling back to speech-to-text'
		);

		log('downloading audio');
		const audio = await ytdlp.downloadAudio(options.url, tmpDir, {
			...active,
			onProgress: progressLogger(log, 'audio download'),
		});

		const spokenLanguage = options.languageExplicit ? options.languages[0] : 'auto';
		const backend = fasterWhisper.pickBackend(options);

		if (backend === 'faster') {
			const model = fasterWhisper.resolveModel(options.whisperModel, options);
			log(`transcribing with faster-whisper ${model} (language: ${spokenLanguage})`);
			const result = await fasterWhisper.transcribe(audio, tmpDir, {
				...options,
				language: spokenLanguage,
				duration: info.duration,
				onProgress: progressLogger(log, 'transcription'),
			});

			cues = subtitles.normalizeCues(subtitles.parseSrt(fs.readFileSync(result.srtPath, 'utf8')));
			language = result.detectedLanguage || spokenLanguage;
			source = {
				kind: 'whisper',
				backend: 'faster-whisper',
				model: result.modelName,
				device: result.device,
				language,
			};
		} else {
			log(`transcribing with whisper ${options.whisperModel} (language: ${spokenLanguage})`);
			const result = await whisper.transcribe(audio, tmpDir, {
				...options,
				language: spokenLanguage,
				duration: info.duration,
				onProgress: progressLogger(log, 'transcription'),
			});

			cues = subtitles.normalizeCues(subtitles.parseSrt(fs.readFileSync(result.srtPath, 'utf8')));
			language = result.detectedLanguage || spokenLanguage;
			source = { kind: 'whisper', backend: 'whisper.cpp', model: result.modelName, language };
		}
	}

	const paragraphs = subtitles.buildParagraphs(cues);
	if (!paragraphs.length) {
		throw new StageError('transcribe', 'the transcript is empty');
	}

	return {
		body: subtitles.renderTranscript(paragraphs, { forceHours: Number(info.duration || 0) >= 3600 }),
		cues,
		source,
		language,
		paragraphs: paragraphs.length,
	};
}

async function runVideo(options, warn, log) {
	await ensureLogin(options, log);

	const probed = await probeWithAuth(options, warn);
	const info = probed.info;

	log(`title: ${info.title || '(untitled)'}`);
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-video-'));

	try {
		const transcript = await collectTranscript(options, info, probed.auth, tmpDir, warn, log);
		const built = buildMarkdown(info, options, transcript);
		const fileStem = renderFilename(options.filenamePattern, built.payload);
		const outputPath = writeMarkdownFile(options.outputDir, fileStem, built.markdown);

		let srtPath = null;
		if (options.saveSrt) {
			srtPath = uniquePath(outputPath.replace(/\.md$/i, '.srt'));
			fs.writeFileSync(srtPath, subtitles.toSrt(transcript.cues), 'utf8');
		}

		let audioPath = null;
		if (options.keepAudio) {
			const audio = fs.readdirSync(tmpDir).find((name) => /^audio\.(m4a|webm|opus|mp3|wav|aac|ogg|flac)$/i.test(name));
			if (audio) {
				audioPath = uniquePath(path.join(options.outputDir, path.basename(audio)));
				fs.copyFileSync(path.join(tmpDir, audio), audioPath);
			}
		}

		return {
			info,
			outputPath,
			srtPath,
			audioPath,
			markdownLength: built.markdown.length,
			transcript,
			meta: built.meta,
		};
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

function escapeCell(value) {
	return String(value || '')
		.replace(/\|/g, '\\|')
		.replace(/\r?\n/g, ' ')
		.trim();
}

/** Pure so the index layout can be unit-tested without touching the filesystem. */
function renderPlaylistIndex(list, items, failures = []) {
	const source = list.webpage_url || list.original_url || '';
	// Channel/space listings come back without a title; the url says more than "Playlist".
	const title = String(list.title || '').trim() || source || 'Playlist';
	const lines = [
		'---',
		`title: ${JSON.stringify(title)}`,
		`source: ${JSON.stringify(source)}`,
		`transcribed_at: ${JSON.stringify(new Date().toISOString())}`,
		'---',
		'',
		`# ${title}`,
		'',
		`共 ${items.length} 讲${failures.length ? `，${failures.length} 讲失败` : ''}。`,
		'',
		'| # | 标题 | 时长 | 文件 |',
		'| --- | --- | --- | --- |',
	];

	items.forEach((item, index) => {
		const name = path.basename(item.outputPath || '');
		lines.push(
			`| ${index + 1} | ${escapeCell(item.title)} | ${item.duration || ''} | ` +
				`[${escapeCell(name)}](<${name}>) |`
		);
	});

	if (failures.length) {
		lines.push('', '## 失败', '');
		for (const failure of failures) {
			lines.push(`- ${escapeCell(failure.title)} — ${escapeCell(failure.error)}`);
		}
	}

	lines.push('');
	return lines.join('\n');
}

/**
 * Run `total` independent tasks with `jobs` in flight. Results keep the input
 * order regardless of completion order, so playlist indexes stay stable.
 */
async function mapPool(total, jobs, task) {
	const results = new Array(total);
	let cursor = 0;

	const worker = async () => {
		for (;;) {
			const index = cursor++;
			if (index >= total) return;
			results[index] = await task(index);
		}
	};

	await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, total)) }, worker));
	return results;
}

/**
 * A playlist is just N independent single-video runs plus an index. Per-video
 * failures are collected instead of aborting the whole course. With a GPU
 * backend the default is two videos at a time: a transcribed lecture is mostly
 * waiting on the model, and 11 GB holds two float32 models comfortably.
 */
async function runPlaylist(options, warn, log) {
	await ensureLogin(options, log);

	const batchStart = Date.now();
	const list = await ytdlp.probePlaylist(options.url, options);
	const entries = (list.entries || []).filter(Boolean);
	if (!entries.length) {
		throw new StageError('download', 'this URL has no playlist entries — drop --playlist for a single video');
	}

	const selected = options.limit > 0 ? entries.slice(0, options.limit) : entries;
	const autoJobs = fasterWhisper.pickBackend(options) === 'faster' ? 2 : 1;
	const jobs = Math.max(1, Math.min(options.jobs || autoJobs, selected.length));
	log(`playlist: ${list.title || '(untitled)'} — ${selected.length}/${entries.length} videos, ${jobs} at a time`);

	const results = await mapPool(selected.length, jobs, async (index) => {
		const entry = selected[index];
		const url = ytdlp.entryUrl(entry);
		const label = entry.title || url || `#${index + 1}`;
		const tag = `[${index + 1}/${selected.length}]`;
		const itemLog = (message) => log(`${tag} ${message}`);
		const itemWarn = (code, message) => warn(code, `${tag} ${message}`);

		if (!url) {
			itemWarn('item_failed', 'could not build a video url from this entry');
			return { ok: false, failure: { title: label, error: 'could not build a video url from this entry' } };
		}

		itemLog(label);
		try {
			const result = await runVideo({ ...options, url, playlist: false, login: false }, itemWarn, itemLog);
			itemLog(`done, ${Math.round((Date.now() - batchStart) / 1000)}s elapsed`);
			return {
				ok: true,
				item: {
					title: result.info.title || label,
					url,
					outputPath: result.outputPath,
					duration: result.meta.duration,
					paragraphs: result.transcript.paragraphs,
				},
			};
		} catch (error) {
			const message = describeError(error);
			itemWarn('item_failed', `${label}: ${message}`);
			return { ok: false, failure: { title: label, url, error: message } };
		}
	});

	const items = [];
	const failures = [];
	for (const result of results) {
		if (!result) continue;
		if (result.ok) items.push(result.item);
		else failures.push(result.failure);
	}

	fs.mkdirSync(options.outputDir, { recursive: true });
	const indexPath = uniquePath(path.join(options.outputDir, '00-Index.md'));
	fs.writeFileSync(indexPath, renderPlaylistIndex(list, items, failures), 'utf8');

	return { list, items, failures, indexPath };
}

async function main(argv = process.argv.slice(2)) {
	const startMs = Date.now();
	const warnings = [];
	const warn = (code, message) => {
		warnings.push({ code, message });
		process.stderr.write(`[warn] ${code}: ${message}\n`);
	};
	const log = (message) => process.stderr.write(`[info] ${message}\n`);

	let options;
	try {
		const parsed = parseVideoArgs(argv);
		if (parsed.help) {
			process.stdout.write(`${USAGE}\n`);
			return;
		}
		if (parsed.version) {
			process.stdout.write(`${pkg.version}\n`);
			return;
		}
		options = parsed;
	} catch (error) {
		process.stderr.write(`[error] ${describeError(error)}\n`);
		process.exitCode = 1;
		return;
	}

	try {
		options.proxy = await resolveProxy(options, log);

		if (options.playlist) {
			const batch = await runPlaylist(options, warn, log);
			process.stdout.write(
				`${JSON.stringify(
					{
						ok: batch.items.length > 0,
						playlist: true,
						url: options.url,
						title: batch.list.title,
						count: batch.items.length,
						failed: batch.failures.length,
						indexPath: batch.indexPath,
						items: batch.items,
						failures: batch.failures,
						warnings,
						elapsedMs: Date.now() - startMs,
					},
					null,
					2
				)}\n`
			);
			if (!batch.items.length) process.exitCode = 1;
			return;
		}

		const result = await runVideo(options, warn, log);

		process.stdout.write(
			`${JSON.stringify(
				{
					ok: true,
					url: result.info.webpage_url || options.url,
					title: result.info.title,
					outputPath: result.outputPath,
					srtPath: result.srtPath,
					audioPath: result.audioPath,
					contentLength: result.markdownLength,
					transcriptSource: result.transcript.source,
					language: result.transcript.language,
					duration: result.meta.duration,
					paragraphs: result.transcript.paragraphs,
					warnings,
					elapsedMs: Date.now() - startMs,
				},
				null,
				2
			)}\n`
		);
	} catch (error) {
		const stage = error instanceof StageError ? error.stage : 'unknown';
		process.stderr.write(
			`${JSON.stringify(
				{
					ok: false,
					stage,
					error: describeError(error),
					url: options.url,
					warnings,
					elapsedMs: Date.now() - startMs,
				},
				null,
				2
			)}\n`
		);
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}

module.exports = {
	buildMarkdown,
	collectTranscript,
	main,
	mapPool,
	renderPlaylistIndex,
	runPlaylist,
	siteLabel,
};
