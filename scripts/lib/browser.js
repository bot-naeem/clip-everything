'use strict';

const fs = require('node:fs');

const { chromium } = require('playwright-core');

const { StageError } = require('./errors');

const VIEWPORT = { width: 1440, height: 900 };

const LAUNCH_ARGS = [
	'--disable-blink-features=AutomationControlled',
	'--no-first-run',
	'--no-default-browser-check',
];

/**
 * Launch order for `--browser auto`.
 * Windows ships Edge, macOS ships nothing usable by default but Chrome is common;
 * a downloaded Chromium wins when present because it is the most predictable.
 */
function resolveAttempts(requested) {
	if (requested && requested !== 'auto') return [requested];
	if (process.platform === 'win32') return ['msedge', 'chrome', 'chromium'];
	return ['chromium', 'chrome', 'msedge'];
}

function channelFor(name) {
	return name === 'chromium' ? undefined : name;
}

async function launch(options) {
	const attempts = resolveAttempts(options.browser);
	const failures = [];

	for (const name of attempts) {
		try {
			const handle = await open(name, options);
			return { ...handle, browserName: name };
		} catch (error) {
			failures.push(`${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
		}
	}

	throw new StageError(
		'start',
		`could not launch a browser (tried ${attempts.join(', ')}). ` +
			'Install Chromium with "npm run install-browser", or pass --browser chrome|msedge. ' +
			`Details -> ${failures.join(' | ')}`
	);
}

async function open(name, options) {
	const launchOptions = {
		headless: options.headless,
		args: LAUNCH_ARGS,
		viewport: VIEWPORT,
	};
	const channel = channelFor(name);
	if (channel) launchOptions.channel = channel;

	if (options.persist) {
		fs.mkdirSync(options.profileDir, { recursive: true });
		const context = await chromium.launchPersistentContext(options.profileDir, launchOptions);
		return { context, browser: null };
	}

	const browser = await chromium.launch(launchOptions);
	const context = await browser.newContext({ viewport: VIEWPORT });
	return { context, browser };
}

async function close(handle) {
	if (!handle) return;
	try {
		await handle.context.close();
	} catch {
		// already gone
	}
	try {
		if (handle.browser) await handle.browser.close();
	} catch {
		// already gone
	}
}

async function openPage(handle, options) {
	const context = handle.context;
	const page = context.pages().find((candidate) => candidate.url() === 'about:blank') || (await context.newPage());
	page.setDefaultTimeout(options.timeoutMs);
	return page;
}

async function navigate(page, options, warn) {
	const url = options.url;
	try {
		await page.goto(url, { waitUntil: options.wait, timeout: options.timeoutMs });
		return;
	} catch (error) {
		// Long-lived connections (X, chat apps) never reach networkidle - degrade instead of failing.
		if (options.wait !== 'networkidle') {
			throw new StageError('navigate', `failed to load ${url}: ${error instanceof Error ? error.message.split('\n')[0] : error}`, error);
		}
		warn('wait_fallback', 'networkidle never settled, retrying with domcontentloaded');
	}

	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
	} catch (error) {
		throw new StageError('navigate', `failed to load ${url}: ${error instanceof Error ? error.message.split('\n')[0] : error}`, error);
	}
}

module.exports = {
	VIEWPORT,
	close,
	launch,
	navigate,
	openPage,
	resolveAttempts,
};
