'use strict';

/**
 * Subtitle parsing and clean-up.
 *
 * Everything here is pure (string in, objects out) so it can be unit-tested
 * without yt-dlp, ffmpeg or whisper. The three formats that matter:
 *
 *   - json3  YouTube's own JSON, what yt-dlp downloads for `--sub-format json3`
 *   - vtt    WebVTT, manual captions and YouTube's auto captions
 *   - srt    SubRip, what whisper.cpp writes
 *
 * YouTube auto captions are *rolling*: cue N+1 repeats cue N and appends a few
 * words. Naively joining them duplicates most of the transcript, so
 * `normalizeCues()` collapses the overlap before `buildParagraphs()` groups the
 * result into readable blocks.
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

const NON_SPEECH_RE = /^[\[(][^\])]{0,60}(?:music|applause|laughter|silence|inaudible|blank[_ ]?audio|音乐|掌声|笑声|静音)[^\])]{0,60}[\])]$/i;

const TIMESTAMP_RE = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

function parseTimestamp(value) {
	const match = TIMESTAMP_RE.exec(String(value).trim());
	if (!match) return null;
	const [, hours, minutes, seconds, fraction] = match;
	const ms = fraction ? Number(fraction.padEnd(3, '0')) : 0;
	return Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds) + ms / 1000;
}

/**
 * Remove caption markup while leaving ordinary text alone: `<c>` spans,
 * inline `<00:00:01.234>` timing tags, ASS override blocks and HTML entities.
 */
function stripTags(text) {
	return String(text === undefined || text === null ? '' : text)
		.replace(/\r\n?/g, '\n')
		.replace(/<\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}>/g, '')
		.replace(/<\/?(?:c|i|b|u|font|ruby|rt|v|lang|span)(?:\.[^>]*)?(?:\s[^>]*)?>/gi, '')
		.replace(/\{\\[^}]*\}/g, '')
		.replace(/[♪♫]/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t\u00a0]+/g, ' ')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join(' ')
		.trim();
}

function splitBlocks(text) {
	return String(text)
		.replace(/\r\n?/g, '\n')
		.replace(/^\uFEFF/, '')
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean);
}

function parseVtt(text) {
	const cues = [];
	for (const block of splitBlocks(text)) {
		if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(block)) continue;
		const lines = block.split('\n');
		const timingIndex = lines.findIndex((line) => line.includes('-->'));
		if (timingIndex === -1) continue;

		const [rawStart, rawRest] = lines[timingIndex].split('-->');
		const rawEnd = (rawRest || '').trim().split(/\s+/)[0];
		const start = parseTimestamp(rawStart);
		const end = parseTimestamp(rawEnd);
		if (start === null || end === null) continue;

		const body = stripTags(lines.slice(timingIndex + 1).join('\n'));
		if (!body) continue;
		cues.push({ start, end, text: body });
	}
	return cues;
}

function parseSrt(text) {
	const cues = [];
	for (const block of splitBlocks(text)) {
		const lines = block.split('\n');
		const timingIndex = lines.findIndex((line) => line.includes('-->'));
		if (timingIndex === -1) continue;

		const [rawStart, rawRest] = lines[timingIndex].split('-->');
		const rawEnd = (rawRest || '').trim().split(/\s+/)[0];
		const start = parseTimestamp(rawStart);
		const end = parseTimestamp(rawEnd);
		if (start === null || end === null) continue;

		const body = stripTags(lines.slice(timingIndex + 1).join('\n'));
		if (!body) continue;
		cues.push({ start, end, text: body });
	}
	return cues;
}

/**
 * json3 events either start a new line or append to the previous one
 * (`aAppend: 1`), and word timings live in `segs`.
 */
function parseJson3(text) {
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		return [];
	}
	const events = Array.isArray(payload && payload.events) ? payload.events : [];
	const cues = [];

	for (const event of events) {
		if (!event || !Array.isArray(event.segs)) continue;
		const raw = event.segs.map((seg) => (seg && seg.utf8) || '').join('');
		const body = stripTags(raw);
		if (!body) continue;

		const start = Number(event.tStartMs || 0) / 1000;
		const duration = Number(event.dDurationMs || 0) / 1000;
		const previous = cues[cues.length - 1];

		if (event.aAppend && previous) {
			previous.text = joinText(previous.text, body);
			previous.end = Math.max(previous.end, start + duration);
			continue;
		}
		cues.push({ start, end: start + duration, text: body });
	}
	return cues;
}

function detectFormat(text, hint = '') {
	const extension = String(hint).toLowerCase();
	if (extension.endsWith('json3') || extension.endsWith('.json')) return 'json3';
	if (extension.endsWith('.vtt')) return 'vtt';
	if (extension.endsWith('.srt')) return 'srt';

	const head = String(text).trimStart();
	if (head.startsWith('{')) return 'json3';
	if (head.startsWith('WEBVTT')) return 'vtt';
	return 'srt';
}

function parseSubtitles(text, hint = '') {
	const format = detectFormat(text, hint);
	if (format === 'json3') return parseJson3(text);
	if (format === 'vtt') return parseVtt(text);
	return parseSrt(text);
}

/** True when no space belongs between the two fragments (CJK text). */
function needsSpace(left, right) {
	if (!left || !right) return false;
	const last = left.slice(-1);
	const first = right.slice(0, 1);
	if (CJK_RE.test(last) || CJK_RE.test(first)) return false;
	if (/^[,.;:!?%)\]}]/.test(first)) return false;
	return true;
}

function joinText(left, right) {
	const a = String(left || '').trim();
	const b = String(right || '').trim();
	if (!a) return b;
	if (!b) return a;
	return needsSpace(a, b) ? `${a} ${b}` : `${a}${b}`;
}

/**
 * Collapse YouTube's rolling captions and drop non-speech markers.
 *
 * Auto captions repeat the tail of the previous cue at the head of the next one
 * ("hello world" -> "hello world again"), so when a cue extends the previous
 * text we keep only the new part.
 */
function normalizeCues(cues) {
	const out = [];

	for (const cue of cues) {
		const text = stripTags(cue.text);
		if (!text || NON_SPEECH_RE.test(text)) continue;

		const previous = out[out.length - 1];
		if (!previous) {
			out.push({ start: cue.start, end: cue.end, text });
			continue;
		}

		if (text === previous.text || previous.text.endsWith(text)) continue;

		if (text.startsWith(previous.text)) {
			const delta = text.slice(previous.text.length).trim();
			if (!delta) continue;
			previous.text = joinText(previous.text, delta);
			previous.end = Math.max(previous.end, cue.end);
			continue;
		}

		// Word-level overlap, e.g. "the quick brown" -> "brown fox jumps".
		const overlap = longestOverlap(previous.text, text);
		if (overlap >= 4) {
			const delta = text.slice(overlap).trim();
			if (!delta) continue;
			previous.text = joinText(previous.text, delta);
			previous.end = Math.max(previous.end, cue.end);
			continue;
		}

		out.push({ start: cue.start, end: cue.end, text });
	}

	return out;
}

function longestOverlap(left, right) {
	const max = Math.min(left.length, right.length);
	for (let size = max; size >= 4; size--) {
		if (left.slice(-size) === right.slice(0, size)) return size;
	}
	return 0;
}

/**
 * Group cues into paragraphs on long pauses or length, so the note reads like
 * prose instead of one line per caption cue.
 */
function buildParagraphs(cues, options = {}) {
	const gapSec = options.gapSec === undefined ? 2.5 : options.gapSec;
	const maxChars = options.maxChars === undefined ? 380 : options.maxChars;

	const paragraphs = [];
	let current = null;

	for (const cue of cues) {
		if (!current) {
			current = { start: cue.start, end: cue.end, text: cue.text };
			continue;
		}

		const gap = cue.start - current.end;
		const merged = joinText(current.text, cue.text);
		if (gap > gapSec || merged.length > maxChars) {
			paragraphs.push(current);
			current = { start: cue.start, end: cue.end, text: cue.text };
			continue;
		}

		current.text = merged;
		current.end = Math.max(current.end, cue.end);
	}

	if (current) paragraphs.push(current);
	return paragraphs;
}

function pad(value) {
	return String(value).padStart(2, '0');
}

/** 75 -> "01:15", 3725 -> "1:02:05" */
function formatTimestamp(seconds, forceHours = false) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	if (hours > 0 || forceHours) return `${hours}:${pad(minutes)}:${pad(secs)}`;
	return `${pad(minutes)}:${pad(secs)}`;
}

/** Markdown body: one paragraph per block, prefixed with its start time. */
function renderTranscript(paragraphs, options = {}) {
	const forceHours = Boolean(options.forceHours);
	return paragraphs
		.map((paragraph) => `**[${formatTimestamp(paragraph.start, forceHours)}]** ${paragraph.text}`)
		.join('\n\n');
}

/** Re-serialize cues as SRT so the raw timings can be kept next to the note. */
function toSrt(cues) {
	return cues
		.map((cue, index) => {
			const start = srtTimestamp(cue.start);
			const end = srtTimestamp(cue.end);
			return `${index + 1}\n${start} --> ${end}\n${cue.text}\n`;
		})
		.join('\n');
}

function srtTimestamp(seconds) {
	const total = Math.max(0, Number(seconds) || 0);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = Math.floor(total % 60);
	const ms = Math.round((total - Math.floor(total)) * 1000);
	return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(ms).padStart(3, '0')}`;
}

module.exports = {
	buildParagraphs,
	detectFormat,
	formatTimestamp,
	joinText,
	normalizeCues,
	parseJson3,
	parseSrt,
	parseSubtitles,
	parseTimestamp,
	parseVtt,
	renderTranscript,
	stripTags,
	toSrt,
};
