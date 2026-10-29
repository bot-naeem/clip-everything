#!/usr/bin/env node
'use strict';

/**
 * One-time installer for the video pipeline:
 *
 *   yt-dlp       downloads video metadata, captions and audio
 *   ffmpeg       normalises audio to 16 kHz mono PCM for whisper
 *   whisper.cpp  speech-to-text when a video has no captions
 *   ggml model   the actual weights (small by default)
 *
 * Everything lands in ~/.clip-everything/bin, so nothing is installed
 * system-wide and uninstalling is just deleting that folder.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { binDir, isFile, modelDir } = require('./lib/media/tools');
const { detectLocalProxy } = require('./lib/video-args');

const WHISPER_TAG = 'v1.9.2';
const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const WHISPER_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`;

const WHISPER_FILES = [
	'whisper-cli.exe',
	'whisper.dll',
	'ggml.dll',
	'ggml-base.dll',
	'ggml-cpu-alderlake.dll',
	'ggml-cpu-cannonlake.dll',
	'ggml-cpu-cascadelake.dll',
	'ggml-cpu-haswell.dll',
	'ggml-cpu-icelake.dll',
	'ggml-cpu-sandybridge.dll',
	'ggml-cpu-skylakex.dll',
	'ggml-cpu-sse42.dll',
	'ggml-cpu-x64.dll',
];

const USAGE = [
	'Download the video toolchain into ~/.clip-everything/bin.',
	'',
	'Usage:',
	'  npm run setup:video -- [options]',
	'',
	'Options:',
	'  --model <name>    whisper model to download: tiny | base | small | medium (default: small)',
	'  --proxy <url>     HTTP proxy for the downloads (default: auto-detect local)',
	'  --no-proxy        Never use a proxy',
	'  --force           Re-download files that already exist',
	'  --help, -h',
].join('\n');

function parseArgs(argv) {
	const options = { model: 'small', proxy: 'auto', force: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg === '--force') options.force = true;
		else if (arg === '--no-proxy') options.proxy = null;
		else if (arg === '--proxy') options.proxy = argv[++i] || null;
		else if (arg === '--model') options.model = argv[++i] || 'small';
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function which(command) {
	const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
	return result.status === 0 || result.status === null;
}

function download(url, destination, proxy) {
	const args = ['-fL', '--retry', '3', '--retry-delay', '2', '-o', destination];
	if (proxy) args.push('-x', proxy);
	args.push(url);
	process.stderr.write(`[info] downloading ${path.basename(destination)}\n`);
	const result = spawnSync('curl', args, { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
	if (result.error) throw new Error(`curl is required to download ${url}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`download failed (${result.status}): ${url}`);
}

function extract(zip, destination) {
	fs.mkdirSync(destination, { recursive: true });
	const result = spawnSync('tar', ['-xf', zip, '-C', destination], { encoding: 'utf8', windowsHide: true });
	if (result.error) throw new Error(`tar is required to unpack ${zip}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`could not unpack ${zip}: ${result.stderr || result.status}`);
}

function findFile(root, name) {
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) {
			const found = findFile(full, name);
			if (found) return found;
		} else if (entry.name.toLowerCase() === name.toLowerCase()) {
			return full;
		}
	}
	return null;
}

function copyInto(source, targetDir, name) {
	fs.copyFileSync(source, path.join(targetDir, name));
}

async function install(options) {
	const bin = binDir();
	const models = modelDir();
	fs.mkdirSync(bin, { recursive: true });
	fs.mkdirSync(models, { recursive: true });

	const proxy = options.proxy === 'auto' ? await detectLocalProxy() : options.proxy;
	if (proxy) process.stderr.write(`[info] using proxy ${proxy}\n`);

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-setup-'));

	try {
		// yt-dlp: a single executable on every platform.
		const ytDlp = path.join(bin, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
		if (options.force || !isFile(ytDlp)) {
			const url =
				process.platform === 'win32'
					? YTDLP_URL
					: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
			download(url, ytDlp, proxy);
			if (process.platform !== 'win32') fs.chmodSync(ytDlp, 0o755);
		} else {
			process.stderr.write('[info] yt-dlp already present\n');
		}

		if (process.platform === 'win32') {
			if (options.force || !isFile(path.join(bin, 'ffmpeg.exe'))) {
				const zip = path.join(tmp, 'ffmpeg.zip');
				download(FFMPEG_URL, zip, proxy);
				extract(zip, path.join(tmp, 'ffmpeg'));
				for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
					const found = findFile(path.join(tmp, 'ffmpeg'), name);
					if (found) copyInto(found, bin, name);
				}
			} else {
				process.stderr.write('[info] ffmpeg already present\n');
			}

			if (options.force || !isFile(path.join(bin, 'whisper-cli.exe'))) {
				const zip = path.join(tmp, 'whisper.zip');
				download(WHISPER_URL, zip, proxy);
				extract(zip, path.join(tmp, 'whisper'));
				for (const name of WHISPER_FILES) {
					const found = findFile(path.join(tmp, 'whisper'), name);
					if (found) copyInto(found, bin, name);
				}
			} else {
				process.stderr.write('[info] whisper-cli already present\n');
			}
		} else {
			process.stderr.write(
				'[warn] non-Windows host: install ffmpeg and whisper.cpp yourself ' +
					'(brew install ffmpeg whisper-cpp), then re-run this script.\n'
			);
		}

		const modelPath = path.join(models, `ggml-${options.model}.bin`);
		if (options.force || !isFile(modelPath)) {
			download(`${MODEL_BASE}/ggml-${options.model}.bin`, modelPath, proxy);
		} else {
			process.stderr.write(`[info] model ggml-${options.model}.bin already present\n`);
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}

	process.stderr.write(`[done] tools installed in ${bin}\n`);
}

async function main(argv = process.argv.slice(2)) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`[error] ${error.message}\n\n${USAGE}\n`);
		process.exitCode = 1;
		return;
	}

	if (options.help) {
		process.stdout.write(`${USAGE}\n`);
		return;
	}

	if (!which('curl')) {
		process.stderr.write('[error] curl is required. Windows 10+ and macOS ship it; on Linux install curl.\n');
		process.exitCode = 1;
		return;
	}

	try {
		await install(options);
	} catch (error) {
		process.stderr.write(`[error] ${error.message}\n`);
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}

module.exports = { main };
