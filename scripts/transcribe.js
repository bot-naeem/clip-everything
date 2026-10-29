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

const { StageError } = require('./lib/errors');
const { buildVideoFrontmatter } = require('./lib/frontmatter');
const { getDomain, renderFilename, uniquePath, writeMarkdownFile } = require('./lib/naming');
const subtitles = require('./lib/media/subtitles');
const whisper = require('./lib/media/whisper');
const ytdlp = require('./lib/media/ytdlp');
const { parseVideoArgs, resolveProxy, USAGE } = require('./lib/video-args');

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
		return `Whisper ${source.model} transcript${source.language && source.language !== 'auto' ? ` (${source.language})` : ''}`;
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
 * Anonymous requests from datacenter/proxy IPs hit YouTube's bot wall. When that
 * happens, retry with cookies from an installed browser before giving up.
 */
async function probeWithAuth(options, warn) {
	try {
		const info = await ytdlp.probe(options.url, options);
		return { info, auth: {} };
	} catch (error) {
		const explicit = options.cookiesFromBrowser || options.cookiesFile;
		const recoverable = /wants a signed-in session|locked/i.test(error.message || '');
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
		log(`transcribing with whisper ${options.whisperModel} (language: ${spokenLanguage})`);
		const result = await whisper.transcribe(audio, tmpDir, {
			...options,
			language: spokenLanguage,
			onProgress: progressLogger(log, 'transcription'),
		});

		cues = subtitles.normalizeCues(subtitles.parseSrt(fs.readFileSync(result.srtPath, 'utf8')));
		language = result.detectedLanguage || spokenLanguage;
		source = { kind: 'whisper', model: result.modelName, language };
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

module.exports = { buildMarkdown, collectTranscript, main, siteLabel };
