#!/usr/bin/env node
'use strict';

/**
 * Cross-platform acceptance runner (the bash variants need a POSIX shell).
 *
 *   npm run clip:acceptance
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'clips');

const TIMEOUT_MS = process.env.TIMEOUT_MS || '60000';
const WAIT_MODE = process.env.WAIT_MODE || 'networkidle';
const BROWSER = process.env.BROWSER || 'auto';

const TARGETS = [
	'https://zhuanlan.zhihu.com/p/2007944059558323475?share_code=wpShSwJIjJWb&utm_psn=2010112084201980758',
	'https://x.com/i/status/2025986105485733945',
];

let failed = 0;

for (const url of TARGETS) {
	process.stdout.write(`[acceptance] clipping: ${url}\n`);
	const result = spawnSync(
		process.execPath,
		[
			path.join(__dirname, 'clip.js'),
			url,
			'--output',
			OUT_DIR,
			'--browser',
			BROWSER,
			'--wait',
			WAIT_MODE,
			'--timeout-ms',
			TIMEOUT_MS,
		],
		{ cwd: ROOT, stdio: 'inherit' }
	);

	if (result.status !== 0) {
		failed += 1;
		process.stderr.write(`[acceptance] FAILED: ${url}\n`);
	}
}

if (failed > 0) {
	process.stderr.write(`[acceptance] FAIL: ${failed} of ${TARGETS.length} URLs failed.\n`);
	process.exit(1);
}

process.stdout.write('[acceptance] PASS: both target URLs clipped successfully.\n');
