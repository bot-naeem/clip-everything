'use strict';

const path = require('node:path');
const os = require('node:os');

const WAIT_MODES = ['load', 'domcontentloaded', 'networkidle'];
const BROWSER_CHOICES = ['auto', 'chromium', 'chrome', 'msedge'];

const USAGE = [
	'ClipEverything - clip a web page to a Markdown file using a real browser.',
	'',
	'Usage:',
	'  npm run clip -- <url> [options]',
	'  npx clip-everything <url> [options]',
	'',
	'Options:',
	'  --output <dir>            Output directory (default: ./clips)',
	'  --filename <pattern>      Filename pattern (default: {title})',
	'  --profile <name>          Browser profile name, keeps cookies/login (default: default)',
	'  --profile-dir <dir>       Explicit profile directory (overrides --profile)',
	'  --no-persist              Use a throwaway browser context (no saved cookies)',
	'  --wait <mode>             load | domcontentloaded | networkidle (default: networkidle)',
	'  --timeout-ms <n>          Page timeout in ms (default: 30000)',
	'  --browser <name>          auto | chromium | chrome | msedge (default: auto)',
	'  --headed                  Show the browser window (default: headless)',
	'  --headless                Force headless mode',
	'  --frontmatter             Include YAML frontmatter (default: on)',
	'  --no-frontmatter          Disable YAML frontmatter',
	'  --help, -h                Show this help',
	'  --version, -v             Print version',
	'',
	'Filename tokens:',
	'  {title} {domain} {date} {time}',
	'',
	'Examples:',
	'  npm run clip -- "https://example.com"',
	'  npm run clip -- "https://example.com" --output ~/notes --filename "{date}-{title}"',
	'  npm run clip -- "https://x.com/user/status/123" --browser msedge --headed',
].join('\n');

function fail(message) {
	throw new Error(`${message}\n\nRun with --help for usage.`);
}

function requireValue(args, index, flag) {
	const value = args[index];
	if (!value || value.startsWith('--')) {
		fail(`Missing value for ${flag}`);
	}
	return value;
}

function parseArgs(argv, env = {}) {
	const cwd = env.cwd || process.cwd();
	const homedir = env.homedir || os.homedir();
	const args = [...argv];
	const first = args[0];

	if (first === '--help' || first === '-h' || first === 'help') return { help: true };
	if (first === '--version' || first === '-v' || first === 'version') return { version: true };
	if (!first) fail('Missing <url>.');
	if (first.startsWith('-')) fail(`Unknown option: ${first}`);

	const options = {
		url: first,
		outputDir: path.resolve(cwd, 'clips'),
		filenamePattern: '{title}',
		profile: 'default',
		profileDir: '',
		wait: 'networkidle',
		timeoutMs: 30000,
		frontmatter: true,
		browser: 'auto',
		headless: true,
		persist: true,
	};

	for (let i = 1; i < args.length; i++) {
		const arg = args[i];

		switch (arg) {
			case '--output':
			case '-o': {
				options.outputDir = path.resolve(cwd, requireValue(args, ++i, arg));
				continue;
			}
			case '--filename': {
				options.filenamePattern = requireValue(args, ++i, arg);
				continue;
			}
			case '--profile': {
				options.profile = requireValue(args, ++i, arg);
				continue;
			}
			case '--profile-dir': {
				options.profileDir = path.resolve(cwd, requireValue(args, ++i, arg));
				continue;
			}
			case '--no-persist': {
				options.persist = false;
				continue;
			}
			case '--wait': {
				const value = requireValue(args, ++i, arg);
				if (!WAIT_MODES.includes(value)) {
					fail(`Invalid --wait value "${value}". Use ${WAIT_MODES.join(' | ')}`);
				}
				options.wait = value;
				continue;
			}
			case '--timeout-ms': {
				const raw = requireValue(args, ++i, arg);
				const value = Number(raw);
				if (!Number.isFinite(value) || value <= 0) {
					fail(`Invalid --timeout-ms value "${raw}"`);
				}
				options.timeoutMs = Math.floor(value);
				continue;
			}
			case '--browser': {
				const value = requireValue(args, ++i, arg).toLowerCase();
				if (!BROWSER_CHOICES.includes(value)) {
					fail(`Invalid --browser value "${value}". Use ${BROWSER_CHOICES.join(' | ')}`);
				}
				options.browser = value;
				continue;
			}
			case '--headed': {
				options.headless = false;
				continue;
			}
			case '--headless': {
				options.headless = true;
				continue;
			}
			case '--frontmatter': {
				options.frontmatter = true;
				continue;
			}
			case '--no-frontmatter': {
				options.frontmatter = false;
				continue;
			}
			case '--help':
			case '-h': {
				return { help: true };
			}
			default: {
				fail(`Unknown argument: ${arg}`);
			}
		}
	}

	let parsed;
	try {
		parsed = new URL(options.url);
	} catch {
		fail(`Invalid URL: ${options.url}`);
	}
	if (!/^https?:$/.test(parsed.protocol)) {
		fail(`Unsupported protocol "${parsed.protocol}". Only http(s) URLs are supported.`);
	}
	options.url = parsed.toString();

	if (!options.profileDir) {
		const safeProfile = options.profile.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'default';
		options.profileDir = path.join(homedir, '.clip-everything', 'profiles', safeProfile);
	}

	return options;
}

module.exports = {
	BROWSER_CHOICES,
	USAGE,
	WAIT_MODES,
	parseArgs,
};
