#!/usr/bin/env node
'use strict';

const { parseArgs, USAGE } = require('./lib/args');
const { StageError } = require('./lib/errors');
const { close, launch, navigate, openPage } = require('./lib/browser');
const { detectBlocked, extract, waitForReady } = require('./lib/extract');
const { buildMarkdown } = require('./lib/markdown');
const { renderFilename, writeMarkdownFile } = require('./lib/naming');
const { findHandler } = require('./lib/sites');

const pkg = require('../package.json');

function describeError(error) {
	if (!error) return 'unknown error';
	const message = error instanceof Error ? error.message : String(error);
	return message.split('\n')[0];
}

async function runClip(options, warn) {
	const handle = await launch(options);
	try {
		const page = await openPage(handle, options);
		await navigate(page, options, warn);

		try {
			// Readiness is a heuristic, not a hard gate: give it a short budget so
			// short or unusual pages do not burn the full --timeout-ms here.
			const readyBudget = Math.min(options.timeoutMs, 8000);
			await waitForReady(page, findHandler(options.url), readyBudget);
		} catch (error) {
			warn('ready_timeout', `page never reported ready, extracting anyway (${describeError(error)})`);
		}

		const blocked = await detectBlocked(page);
		if (blocked) {
			throw new StageError(
				'extract',
				`site returned a wall instead of content (${blocked.reason}): "${blocked.snippet}". ` +
					`Run once with --headed --profile <name> and sign in, then clip again.`
			);
		}

		let payload;
		try {
			payload = await extract(page, options);
		} catch (error) {
			if (error instanceof StageError) throw error;
			throw new StageError('extract', describeError(error), error);
		}

		const { markdown, converterUsed } = buildMarkdown(payload, options.frontmatter);
		const fileStem = renderFilename(options.filenamePattern, payload);
		const outputPath = writeMarkdownFile(options.outputDir, fileStem, markdown);

		return { payload, markdown, converterUsed, outputPath, browserName: handle.browserName };
	} finally {
		await close(handle);
	}
}

async function main() {
	const argv = process.argv.slice(2);

	// `clip --video <url>` is the video pipeline; it has its own options and does
	// not touch the browser at all.
	if (argv.includes('--video')) {
		const { main: runVideo } = require('./transcribe');
		await runVideo(argv.filter((arg) => arg !== '--video'));
		return;
	}

	const startMs = Date.now();
	const warnings = [];
	const warn = (code, message) => {
		warnings.push({ code, message });
		process.stderr.write(`[warn] ${code}: ${message}\n`);
	};

	let options;
	try {
		const parsed = parseArgs(process.argv.slice(2));
		if (parsed.help) {
			process.stdout.write(`${USAGE}\n`);
			return;
		}
		if (parsed.version) {
			process.stdout.write(`${pkg.version}\n`);
			return;
		}
		options = parsed;
	} catch (error) {
		process.stderr.write(`[error] ${describeError(error)}\n`);
		process.exitCode = 1;
		return;
	}

	try {
		const result = await runClip(options, warn);

		process.stdout.write(
			`${JSON.stringify(
				{
					ok: true,
					url: result.payload.url,
					title: result.payload.title,
					outputPath: result.outputPath,
					contentLength: result.markdown.length,
					converterUsed: result.converterUsed,
					extractor: result.payload.extractor,
					browser: result.browserName,
					warnings,
					elapsedMs: Date.now() - startMs,
				},
				null,
				2
			)}\n`
		);
	} catch (error) {
		const stage = error instanceof StageError ? error.stage : 'unknown';
		process.stderr.write(
			`${JSON.stringify(
				{
					ok: false,
					stage,
					error: describeError(error),
					url: options.url,
					warnings,
					elapsedMs: Date.now() - startMs,
				},
				null,
				2
			)}\n`
		);
		process.exitCode = 1;
	}
}

main();
