'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { StageError } = require('../errors');
const { run } = require('./ytdlp');
const { toWav, transcriptionTimeout, whisperLanguage } = require('./whisper');

/**
 * GPU speech-to-text through faster-whisper.
 *
 * whisper.cpp is the zero-dependency default, but its Windows release is
 * CPU-only: no CUDA build, no large models that fit in a sensible time budget.
 * faster-whisper runs on any CUDA GPU via pip wheels, so it is the optional
 * "better models, much faster" backend.
 *
 * Configuration is by environment variable so a user can point the CLI at their
 * own install without flags on every run:
 *
 *   CLIP_PYTHON                     python executable (default: python)
 *   CLIP_FASTER_WHISPER_MODEL       model directory or Hugging Face id
 *   CLIP_FASTER_WHISPER_DEVICE      cuda | cpu | auto (default: auto -> cuda)
 *   CLIP_FASTER_WHISPER_COMPUTE     float16 | float32 | int8_float16 | ...
 */

const BRIDGE = path.join(__dirname, 'faster_whisper_bridge.py');

function pythonExecutable(options = {}) {
	const env = options.env || process.env;
	return options.python || env.CLIP_PYTHON || 'python';
}

function defaultModel(options = {}) {
	const env = options.env || process.env;
	return options.whisperModelFile || env.CLIP_FASTER_WHISPER_MODEL || 'large-v3';
}

/** An explicit --whisper-model wins, then config/env, then large-v3. */
function resolveModel(name, options = {}) {
	const env = options.env || process.env;
	if (options.whisperModelFile) return options.whisperModelFile;
	if (env.CLIP_FASTER_WHISPER_MODEL) return env.CLIP_FASTER_WHISPER_MODEL;
	if (name && (path.isAbsolute(name) || name.includes('/') || name.includes('\\'))) return name;
	return name || 'large-v3';
}

function bridgeArgs(model, audioPath, prefix, options = {}) {
	const env = options.env || process.env;
	const args = [
		BRIDGE,
		'--model',
		model,
		'--audio',
		audioPath,
		'--out',
		prefix,
		'--language',
		whisperLanguage(options.language),
		'--device',
		options.whisperDevice || env.CLIP_FASTER_WHISPER_DEVICE || 'auto',
	];
	const compute = options.whisperCompute || env.CLIP_FASTER_WHISPER_COMPUTE;
	if (compute) args.push('--compute', compute);
	if (env.CLIP_FASTER_WHISPER_BEAM) args.push('--beam', env.CLIP_FASTER_WHISPER_BEAM);
	if (options.threads) args.push('--threads', String(options.threads));
	return args;
}

async function transcribe(audioPath, dir, options = {}) {
	fs.mkdirSync(dir, { recursive: true });
	const wavPath = path.join(dir, 'audio.wav');
	if (path.resolve(wavPath) !== path.resolve(audioPath)) await toWav(audioPath, wavPath, options);

	const model = resolveModel(options.whisperModel, options);
	const prefix = path.join(dir, 'transcript');
	let detectedLanguage = null;

	const result = await run(pythonExecutable(options), bridgeArgs(model, wavPath, prefix, options), {
		timeoutMs: transcriptionTimeout(options),
		stage: 'transcribe',
		onStderr: (text) => {
			const match = /progress\s*=\s*(\d+)%/.exec(text);
			if (match && options.onProgress) options.onProgress(Number(match[1]));
		},
	});

	if (result.code !== 0) {
		const detail = result.stderr.trim().split('\n').filter(Boolean).pop() || `exit code ${result.code}`;
		const hint =
			'(install it with "python -m pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12" ' +
			'and point CLIP_FASTER_WHISPER_MODEL at the model directory)';
		throw new StageError('transcribe', `faster-whisper failed: ${detail} ${hint}`);
	}

	let meta = {};
	try {
		meta = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
	} catch {
		meta = {};
	}
	detectedLanguage = meta.language || null;

	const srtPath = `${prefix}.srt`;
	if (!fs.existsSync(srtPath)) {
		throw new StageError('transcribe', 'faster-whisper reported success but wrote no SRT file');
	}

	return {
		srtPath,
		wavPath,
		modelPath: model,
		modelName: path.basename(model) || model,
		detectedLanguage,
		device: meta.device || null,
		compute: meta.compute || null,
	};
}

/** auto: use the GPU backend when a model has been configured. */
function pickBackend(options = {}) {
	const env = options.env || process.env;
	if (options.whisperBackend && options.whisperBackend !== 'auto') return options.whisperBackend;
	if (options.whisperModelFile || env.CLIP_FASTER_WHISPER_MODEL) return 'faster';
	return 'cpp';
}

module.exports = { BRIDGE, bridgeArgs, defaultModel, pickBackend, pythonExecutable, resolveModel, transcribe };
