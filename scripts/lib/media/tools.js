'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { StageError } = require('../errors');

/**
 * External binaries live outside node_modules: they are 100-500 MB and are not
 * npm packages. `npm run setup:video` puts them in ~/.clip-everything/bin, and
 * every lookup can be overridden with an environment variable.
 */

const TOOLS = {
	ytDlp: { exe: 'yt-dlp', env: 'CLIP_YTDLP', label: 'yt-dlp' },
	ffmpeg: { exe: 'ffmpeg', env: 'CLIP_FFMPEG', label: 'ffmpeg' },
	ffprobe: { exe: 'ffprobe', env: 'CLIP_FFPROBE', label: 'ffprobe' },
	whisper: { exe: 'whisper-cli', env: 'CLIP_WHISPER', label: 'whisper-cli' },
};

function binDir(homedir = os.homedir()) {
	return path.join(homedir, '.clip-everything', 'bin');
}

function modelDir(homedir = os.homedir()) {
	return path.join(binDir(homedir), 'models');
}

function isFile(target) {
	try {
		return fs.statSync(target).isFile();
	} catch {
		return false;
	}
}

function withExtensions(base, env) {
	if (process.platform !== 'win32') return [base];
	const exts = String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
	return [base, ...exts.map((ext) => `${base}${ext.toLowerCase()}`)];
}

function findOnPath(name, env) {
	const dirs = String(env.PATH || '')
		.split(path.delimiter)
		.filter(Boolean);
	for (const dir of dirs) {
		for (const candidate of withExtensions(name, env)) {
			const full = path.join(dir, candidate);
			if (isFile(full)) return full;
		}
	}
	return null;
}

/**
 * Resolution order: explicit env override, our own bin dir, then PATH.
 * Returns null instead of throwing so callers can build a helpful message.
 */
function findTool(key, options = {}) {
	const spec = TOOLS[key];
	if (!spec) throw new Error(`Unknown tool: ${key}`);

	const env = options.env || process.env;
	const homedir = options.homedir || os.homedir();

	const override = env[spec.env];
	if (override && isFile(override)) return override;

	const local = path.join(binDir(homedir), spec.exe);
	for (const candidate of withExtensions(local, env)) {
		if (isFile(candidate)) return candidate;
	}

	return findOnPath(spec.exe, env);
}

function requireTool(key, options = {}) {
	const found = findTool(key, options);
	if (found) return found;

	const spec = TOOLS[key];
	throw new StageError(
		'start',
		`${spec.label} not found. Run "npm run setup:video" to download the video tools, ` +
			`or set ${spec.env} to its full path.`
	);
}

/** ggml-small.bin and friends, resolved by short name ("small"). */
function resolveWhisperModel(name, options = {}) {
	const env = options.env || process.env;
	const homedir = options.homedir || os.homedir();

	if (env.CLIP_WHISPER_MODEL && isFile(env.CLIP_WHISPER_MODEL)) return env.CLIP_WHISPER_MODEL;

	const candidate = path.isAbsolute(String(name))
		? String(name)
		: path.join(modelDir(homedir), `ggml-${name}.bin`);
	if (isFile(candidate)) return candidate;

	throw new StageError(
		'start',
		`whisper model "${name}" not found at ${candidate}. ` +
			'Run "npm run setup:video" (it downloads ggml-small.bin) or pass --whisper-model <name>.'
	);
}

module.exports = {
	TOOLS,
	binDir,
	findOnPath,
	findTool,
	isFile,
	modelDir,
	requireTool,
	resolveWhisperModel,
};
