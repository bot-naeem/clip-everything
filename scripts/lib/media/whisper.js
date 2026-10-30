'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { StageError } = require('../errors');
const { requireTool, resolveWhisperModel } = require('./tools');
const { run } = require('./ytdlp');

/**
 * Speech-to-text fallback for videos without captions.
 * ffmpeg normalises the audio (whisper.cpp wants 16 kHz mono PCM) and
 * whisper-cli writes an SRT that the subtitle parser can reuse.
 */

async function toWav(input, output, options = {}) {
	const ffmpeg = requireTool('ffmpeg', options);
	const result = await run(
		ffmpeg,
		['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output],
		{ timeoutMs: options.timeoutMs || 600000 }
	);

	if (result.code !== 0) {
		throw new StageError('transcribe', `ffmpeg could not convert the audio: ${result.stderr.trim().split('\n').pop()}`);
	}
}

/** whisper.cpp only knows base languages: zh-Hans -> zh, en-US -> en. */
function whisperLanguage(language) {
	if (!language || language === 'auto') return 'auto';
	return String(language).split(/[-_]/)[0].toLowerCase();
}

/**
 * A 40 minute lecture needs ~17 minutes on a 4-core CPU, which is already past
 * the 10 minute network timeout. Speech-to-text therefore gets its own budget:
 * at least an hour, or 8x the audio duration (a very slow machine at 1/8
 * realtime still fits), whichever is larger.
 */
function transcriptionTimeout(options = {}) {
	if (options.whisperTimeoutMs) return options.whisperTimeoutMs;
	const byDuration = (Number(options.duration) || 0) * 8 * 1000;
	return Math.max(options.timeoutMs || 0, 3600000, byDuration);
}

async function transcribe(audioPath, dir, options = {}) {
	const whisper = requireTool('whisper', options);
	const modelName = options.whisperModel || 'small';
	const model = resolveWhisperModel(modelName, options);

	fs.mkdirSync(dir, { recursive: true });
	const wavPath = path.join(dir, 'audio.wav');
	await toWav(audioPath, wavPath, options);

	const prefix = path.join(dir, 'transcript');
	let detectedLanguage = null;
	const args = [
		'-m',
		model,
		'-f',
		wavPath,
		'-l',
		whisperLanguage(options.language),
		'-osrt',
		'-of',
		prefix,
		'--print-progress',
	];
	if (options.threads) args.push('-t', String(options.threads));

	const result = await run(whisper, args, {
		timeoutMs: transcriptionTimeout(options),
		stage: 'transcribe',
		onStderr: (text) => {
			const detected = /auto-detected language:\s*([a-zA-Z-]+)/.exec(text);
			if (detected) detectedLanguage = detected[1].toLowerCase();
			const match = /progress\s*=\s*(\d+)%/.exec(text);
			if (match && options.onProgress) options.onProgress(Number(match[1]));
		},
	});

	if (result.code !== 0) {
		throw new StageError('transcribe', `whisper-cli failed: ${result.stderr.trim().split('\n').pop()}`);
	}

	const srtPath = `${prefix}.srt`;
	if (!fs.existsSync(srtPath)) {
		throw new StageError('transcribe', 'whisper-cli reported success but wrote no SRT file');
	}

	return { srtPath, wavPath, modelPath: model, modelName, detectedLanguage };
}

module.exports = { toWav, transcribe, transcriptionTimeout, whisperLanguage };
