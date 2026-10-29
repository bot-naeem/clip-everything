'use strict';

const { spawnSync } = require('node:child_process');

/**
 * yt-dlp needs a JavaScript runtime to solve YouTube's "n" challenge. Without
 * one YouTube stops returning downloadable formats and yt-dlp fails with
 * "Requested format is not available" — even for `--skip-download` metadata.
 *
 * Node is already running this script, so we hand yt-dlp our own executable
 * instead of asking the user to install deno or edit a global config file.
 *
 * CLIP_JS_RUNTIME:
 *   unset        -> node:<the running node executable>
 *   "none"       -> do not pass --js-runtimes (old yt-dlp / custom setups)
 *   "node"       -> let yt-dlp find node on PATH
 *   "deno:..."   -> pass the value through verbatim
 */

const DISABLED = /^(none|off|0|false)$/i;

function runtimeSpec(env = process.env, execPath = process.execPath) {
	const raw = String(env.CLIP_JS_RUNTIME || '').trim();
	if (DISABLED.test(raw)) return null;
	if (!raw) return `node:${execPath}`;
	return raw;
}

// yt-dlp only grew --js-runtimes in late 2025. Probing once per binary keeps
// older installs working instead of failing on an unknown option.
const supportCache = new Map();

function supportsJsRuntimes(bin, options = {}) {
	if (supportCache.has(bin)) return supportCache.get(bin);

	const result = spawnSync(bin, ['--js-runtimes', 'node', '--version'], {
		encoding: 'utf8',
		timeout: options.timeoutMs || 15000,
		windowsHide: true,
	});
	const supported = result.status === 0;
	supportCache.set(bin, supported);
	return supported;
}

function jsRuntimeArgs(bin, options = {}) {
	const spec = runtimeSpec(options.env || process.env, options.execPath || process.execPath);
	if (!spec) return [];

	const supported = options.supports ? options.supports(bin) : supportsJsRuntimes(bin, options);
	return supported ? ['--js-runtimes', spec] : [];
}

module.exports = {
	jsRuntimeArgs,
	runtimeSpec,
	supportsJsRuntimes,
};
