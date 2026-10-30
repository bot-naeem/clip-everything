'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Optional per-user settings, so a GPU setup does not have to be re-exported in
 * every shell. Anything here is a *default*: CLI flags win, then environment
 * variables, then this file.
 *
 *   ~/.clip-everything/config.json
 *   {
 *     "whisper": {
 *       "backend": "faster",
 *       "python": "C:\\Python311\\python.exe",
 *       "model": "D:\\models\\large-v3",
 *       "device": "cuda",
 *       "compute": "float32"
 *     }
 *   }
 */

function configFile(homedir = os.homedir()) {
	return path.join(homedir, '.clip-everything', 'config.json');
}

function readConfig(options = {}) {
	const file = options.configFile || configFile(options.homedir || os.homedir());
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/** Whisper defaults from disk, with environment variables taking precedence. */
function whisperConfig(env = {}, options = {}) {
	const fromFile = (readConfig({ homedir: options.homedir || env.homedir }).whisper) || {};
	return {
		backend: env.CLIP_WHISPER_BACKEND || fromFile.backend || 'auto',
		python: env.CLIP_PYTHON || fromFile.python || null,
		model: env.CLIP_FASTER_WHISPER_MODEL || fromFile.model || null,
		device: env.CLIP_FASTER_WHISPER_DEVICE || fromFile.device || null,
		compute: env.CLIP_FASTER_WHISPER_COMPUTE || fromFile.compute || null,
	};
}

module.exports = { configFile, readConfig, whisperConfig };
