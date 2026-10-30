'use strict';

const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveProfileDir } = require('./args');

const DEFAULT_LANGS = ['zh-Hans', 'zh-CN', 'zh', 'en'];

/** Common local proxy ports (Clash, Clash Verge, v2rayN, Shadowsocks). */
const PROXY_CANDIDATES = [
	'http://127.0.0.1:7890',
	'http://127.0.0.1:7897',
	'http://127.0.0.1:10809',
	'http://127.0.0.1:1080',
];

const USAGE = [
	'ClipEverything - transcribe a video into a timestamped Markdown note.',
	'',
	'Usage:',
	'  npm run clip -- --video <url> [options]',
	'  npm run video -- <url> [options]',
	'  npx clip-everything --video <url> [options]',
	'',
	'Options:',
	'  --output <dir>                 Output directory (default: ./clips)',
	'  --filename <pattern>           Filename pattern (default: {title})',
	'  --lang <codes>                 Subtitle language preference, comma separated',
	`                                 (default: ${DEFAULT_LANGS.join(',')})`,
	'  --whisper-model <name>         Model when speech-to-text is needed (default: small)',
	'  --whisper-backend <name>       auto | cpp | faster (default: auto)',
	'  --no-whisper                   Never fall back to speech-to-text',
	'  --force-whisper                Ignore existing subtitles, transcribe the audio',
	'  --keep-audio                   Keep the downloaded audio file',
	'  --save-srt                     Write the raw <name>.srt next to the note',
	'  --proxy <url>                  HTTP proxy for yt-dlp (default: auto-detect local)',
	'  --no-proxy                     Never use a proxy',
	'  --cookies-from-browser <name>  Reuse a browser session, e.g. edge, chrome, firefox',
	'  --cookies <file>               Netscape cookies.txt exported from a browser',
	'  --profile <name>               Use cookies.txt saved by "npm run login -- --profile <name>"',
	'  --login                        Open a browser to sign in for this site, then continue',
	'  --playlist                     Transcribe every video in a playlist URL',
	'  --limit <n>                    With --playlist, stop after the first n videos',
	'  --jobs <n>                     With --playlist, transcribe n videos at once (default: 2 on GPU, 1 on CPU)',
	'  --threads <n>                  whisper.cpp threads (default: CPU count)',
	'  --whisper-timeout-ms <n>       Speech-to-text timeout (default: max(1h, 8x audio))',
	'  --timeout-ms <n>               Network step timeout (default: 600000)',
	'  --frontmatter                  Include YAML frontmatter (default: on)',
	'  --no-frontmatter               Disable YAML frontmatter',
	'  --help, -h                     Show this help',
	'  --version, -v                  Print version',
	'',
	'Examples:',
	'  npm run clip -- --video "https://www.youtube.com/watch?v=..."',
	'  npm run clip -- --video "https://www.youtube.com/watch?v=..." --lang en --save-srt',
	'  npm run clip -- --video "https://www.bilibili.com/video/BV..." --whisper-model medium',
].join('\n');

function fail(message) {
	throw new Error(`${message}\n\nRun with --help for usage.`);
}

function requireValue(args, index, flag) {
	const value = args[index];
	if (!value || value.startsWith('--')) fail(`Missing value for ${flag}`);
	return value;
}

function parseLanguages(value) {
	const list = String(value)
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
	return list.length ? list : DEFAULT_LANGS;
}

function envProxy(env) {
	return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || null;
}

const PROFILE_ALIASES = [
	[/^(youtu\.be|youtube\.com|m\.youtube\.com)$/i, 'youtube'],
	[/^(b23\.tv|bilibili\.com|m\.bilibili\.com)$/i, 'bilibili'],
	[/^(twitter\.com|x\.com)$/i, 'x'],
];

/** `--login` without `--profile` picks a stable, per-site profile name. */
function defaultProfileFor(url) {
	try {
		const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
		for (const [pattern, name] of PROFILE_ALIASES) {
			if (pattern.test(host)) return name;
		}
		return host.split('.')[0].replace(/[^a-z0-9-]/g, '') || 'default';
	} catch {
		return 'default';
	}
}

const { whisperConfig } = require('./config');

function parseVideoArgs(argv, env = {}) {
	const cwd = env.cwd || process.cwd();
	const homedir = env.homedir || os.homedir();
	const args = [...argv];
	const settings = whisperConfig(env, { homedir });

	// `clip --video <url>` forwards the url positionally; a leading --video is
	// harmless when the script is called directly.
	while (args[0] === '--video') args.shift();

	const options = {
		mode: 'video',
		url: null,
		outputDir: path.join(cwd, 'clips'),
		filenamePattern: '{title}',
		languages: DEFAULT_LANGS,
		languageExplicit: false,
		whisperModel: 'small',
		whisperBackend: settings.backend,
		python: settings.python,
		whisperModelFile: settings.model,
		whisperDevice: settings.device,
		whisperCompute: settings.compute,
		whisper: true,
		forceWhisper: false,
		keepAudio: false,
		saveSrt: false,
		proxy: envProxy(env) || 'auto',
		cookiesFile: null,
		cookiesFromBrowser: null,
		profile: null,
		login: false,
		playlist: false,
		limit: 0,
		jobs: 0,
		threads: 0,
		timeoutMs: 600000,
		whisperTimeoutMs: 0,
		frontmatter: true,
		help: false,
		version: false,
	};

	const positional = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case '--help':
			case '-h':
				options.help = true;
				break;
			case '--version':
			case '-v':
				options.version = true;
				break;
			case '--output':
			case '-o':
				options.outputDir = requireValue(args, ++i, arg);
				break;
			case '--filename':
				options.filenamePattern = requireValue(args, ++i, arg);
				break;
			case '--lang':
			case '--langs':
				options.languages = parseLanguages(requireValue(args, ++i, arg));
				options.languageExplicit = true;
				break;
			case '--whisper-model':
				options.whisperModel = requireValue(args, ++i, arg);
				// An explicit flag beats the model configured in config.json.
				options.whisperModelFile = null;
				break;
			case '--whisper-backend': {
				const backend = requireValue(args, ++i, arg).toLowerCase();
				if (!['auto', 'cpp', 'faster'].includes(backend)) {
					fail('--whisper-backend must be auto, cpp or faster');
				}
				options.whisperBackend = backend;
				break;
			}
			case '--no-whisper':
				options.whisper = false;
				break;
			case '--force-whisper':
				options.forceWhisper = true;
				options.whisper = true;
				break;
			case '--keep-audio':
				options.keepAudio = true;
				break;
			case '--save-srt':
				options.saveSrt = true;
				break;
			case '--proxy':
				options.proxy = requireValue(args, ++i, arg);
				break;
			case '--no-proxy':
				options.proxy = null;
				break;
			case '--cookies-from-browser':
				options.cookiesFromBrowser = requireValue(args, ++i, arg);
				break;
			case '--cookies':
				options.cookiesFile = requireValue(args, ++i, arg);
				break;
			case '--profile':
				options.profile = requireValue(args, ++i, arg);
				break;
			case '--login':
				options.login = true;
				break;
			case '--playlist':
				options.playlist = true;
				break;
			case '--limit':
				options.limit = Number(requireValue(args, ++i, arg)) || 0;
				if (options.limit < 1) fail('--limit must be a positive number');
				break;
			case '--jobs':
				options.jobs = Number(requireValue(args, ++i, arg)) || 0;
				if (options.jobs < 1) fail('--jobs must be a positive number');
				break;
			case '--threads':
				options.threads = Number(requireValue(args, ++i, arg)) || 0;
				break;
			case '--timeout-ms':
				options.timeoutMs = Number(requireValue(args, ++i, arg)) || 0;
				if (!options.timeoutMs) fail('--timeout-ms must be a positive number');
				break;
			case '--whisper-timeout-ms':
				options.whisperTimeoutMs = Number(requireValue(args, ++i, arg)) || 0;
				if (!options.whisperTimeoutMs) fail('--whisper-timeout-ms must be a positive number');
				break;
			case '--frontmatter':
				options.frontmatter = true;
				break;
			case '--no-frontmatter':
				options.frontmatter = false;
				break;
			default:
				if (arg.startsWith('-')) fail(`Unknown argument: ${arg}`);
				positional.push(arg);
		}
	}

	if (options.help || options.version) return options;

	if (!positional.length) fail('Missing <url>.');
	if (positional.length > 1) fail(`Expected one url, got ${positional.length}: ${positional.join(' ')}`);

	let parsed;
	try {
		parsed = new URL(positional[0]);
	} catch {
		fail(`Invalid URL: ${positional[0]}`);
	}
	if (!/^https?:$/.test(parsed.protocol)) fail(`Unsupported protocol "${parsed.protocol}". Only http(s) URLs are supported.`);

	options.url = parsed.toString();
	options.outputDir = path.resolve(cwd, options.outputDir);
	options.cookiesFile = options.cookiesFile ? path.resolve(cwd, options.cookiesFile) : null;
	options.threads = options.threads || Math.max(1, Math.min(8, os.cpus().length - 1));

	// --login picks a per-site profile, so "youtube" is reused on the next run.
	if (options.login && !options.profile) options.profile = defaultProfileFor(options.url);

	// --profile reuses the login command's exported cookies.txt, so yt-dlp does
	// not have to read (and fight over) the browser's locked cookie database.
	if (options.profile && !options.cookiesFile && !options.cookiesFromBrowser) {
		const profileDir = resolveProfileDir(options.profile, homedir);
		const cookies = path.join(profileDir, 'cookies.txt');
		if (fs.existsSync(cookies)) {
			options.cookiesFile = cookies;
		} else if (!options.login) {
			fail(
				`no cookies.txt in profile "${options.profile}". ` +
					`Run "npm run login -- --profile ${options.profile} --url ${parsed.origin}" first, ` +
					'or add --login to open that window automatically.'
			);
		}
	}

	return options;
}

function canConnect(host, port, timeoutMs = 300) {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		const done = (value) => {
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => done(true));
		socket.once('timeout', () => done(false));
		socket.once('error', () => done(false));
		socket.connect(port, host);
	});
}

/**
 * `--proxy auto`: use a proxy only when one is actually listening, so the tool
 * works both on a plain connection and behind Clash/v2ray without extra flags.
 */
async function detectLocalProxy(candidates = PROXY_CANDIDATES) {
	for (const candidate of candidates) {
		const url = new URL(candidate);
		const port = Number(url.port || 80);
		// eslint-disable-next-line no-await-in-loop
		if (await canConnect(url.hostname, port)) return candidate;
	}
	return null;
}

async function resolveProxy(options, log) {
	if (!options.proxy) return null;
	if (options.proxy !== 'auto') return options.proxy;

	const detected = await detectLocalProxy();
	if (detected && log) log(`using local proxy ${detected}`);
	return detected;
}

module.exports = {
	DEFAULT_LANGS,
	PROXY_CANDIDATES,
	USAGE,
	defaultProfileFor,
	detectLocalProxy,
	parseVideoArgs,
	resolveProxy,
};
