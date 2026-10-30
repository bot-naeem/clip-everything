import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import config from '../scripts/lib/config.js';

const { configFile, readConfig, whisperConfig } = config;

function tempHome(contents) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-config-'));
	if (contents !== undefined) {
		fs.mkdirSync(path.join(home, '.clip-everything'), { recursive: true });
		fs.writeFileSync(path.join(home, '.clip-everything', 'config.json'), JSON.stringify(contents));
	}
	return home;
}

describe('readConfig', () => {
	it('returns an empty object when the file is missing', () => {
		expect(readConfig({ homedir: tempHome() })).toEqual({});
	});

	it('returns an empty object when the file is invalid', () => {
		const home = tempHome();
		fs.mkdirSync(path.join(home, '.clip-everything'), { recursive: true });
		fs.writeFileSync(path.join(home, '.clip-everything', 'config.json'), '{nope');
		expect(readConfig({ homedir: home })).toEqual({});
	});

	it('reads the whisper block', () => {
		const home = tempHome({ whisper: { backend: 'faster', model: 'D:/models/turbo' } });
		expect(readConfig({ homedir: home }).whisper.model).toBe('D:/models/turbo');
	});

	it('points at ~/.clip-everything/config.json', () => {
		expect(configFile('C:/home/user')).toBe(path.join('C:/home/user', '.clip-everything', 'config.json'));
	});
});

describe('whisperConfig', () => {
	it('falls back to auto without a file', () => {
		expect(whisperConfig({}, { homedir: tempHome() })).toEqual({
			backend: 'auto',
			python: null,
			model: null,
			device: null,
			compute: null,
		});
	});

	it('lets environment variables beat the file', () => {
		const home = tempHome({ whisper: { backend: 'faster', model: 'D:/file-model', compute: 'int8' } });
		const settings = whisperConfig({ CLIP_FASTER_WHISPER_MODEL: 'D:/env-model' }, { homedir: home });

		expect(settings.backend).toBe('faster');
		expect(settings.model).toBe('D:/env-model');
		expect(settings.compute).toBe('int8');
	});
});
