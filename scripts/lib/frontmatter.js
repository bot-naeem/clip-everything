'use strict';

/**
 * JSON.stringify produces a valid double-quoted YAML scalar, which handles
 * quotes, backslashes, newlines and control characters without hand-rolled escaping.
 */
function yamlString(value) {
	return JSON.stringify(String(value === undefined || value === null ? '' : value));
}

function buildFrontmatter(payload, now = new Date()) {
	const lines = [
		'---',
		`title: ${yamlString(payload.title)}`,
		`source: ${yamlString(payload.url)}`,
		`author: ${yamlString(payload.author)}`,
		`site: ${yamlString(payload.site)}`,
		`published: ${yamlString(payload.published)}`,
		`description: ${yamlString(payload.description)}`,
		`clipped_at: "${now.toISOString()}"`,
		'---',
		'',
	];
	return lines.join('\n');
}

/**
 * Video notes carry a few extra fields that a web clip does not have:
 * duration, the spoken language and how the text was obtained.
 */
function buildVideoFrontmatter(payload, meta = {}, now = new Date()) {
	const lines = [
		'---',
		`title: ${yamlString(payload.title)}`,
		`source: ${yamlString(payload.url)}`,
		`author: ${yamlString(payload.author)}`,
		`site: ${yamlString(payload.site)}`,
		`published: ${yamlString(payload.published)}`,
		`duration: ${yamlString(meta.duration)}`,
		`language: ${yamlString(meta.language)}`,
		`transcript: ${yamlString(meta.transcript)}`,
		`description: ${yamlString(payload.description)}`,
		`clipped_at: "${now.toISOString()}"`,
		'---',
		'',
	];
	return lines.join('\n');
}

module.exports = { buildFrontmatter, buildVideoFrontmatter, yamlString };
