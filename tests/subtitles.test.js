import { describe, expect, it } from 'vitest';

import subtitles from '../scripts/lib/media/subtitles.js';

const {
	buildParagraphs,
	detectFormat,
	formatTimestamp,
	joinText,
	normalizeCues,
	parseJson3,
	parseSrt,
	parseSubtitles,
	parseTimestamp,
	parseVtt,
	renderTranscript,
	stripTags,
	toSrt,
} = subtitles;

// Real shape of a YouTube auto-caption VTT: cue N repeats the tail of cue N-1.
const ROLLING_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.160 --> 00:00:03.519 align:start position:0%
 
welcome<00:00:00.719><c> to</c><00:00:01.000><c> the</c><00:00:01.240><c> course</c>

00:00:03.519 --> 00:00:03.529 align:start position:0%
welcome to the course
 

00:00:03.529 --> 00:00:06.240 align:start position:0%
welcome to the course
today<00:00:04.000><c> we</c><00:00:04.400><c> build</c>

00:00:06.240 --> 00:00:06.250 align:start position:0%
today we build
`;

describe('parseTimestamp', () => {
	it('parses vtt and srt timestamps', () => {
		expect(parseTimestamp('00:01:02.500')).toBeCloseTo(62.5, 3);
		expect(parseTimestamp('01:02:03,250')).toBeCloseTo(3723.25, 3);
		expect(parseTimestamp('02:03')).toBe(123);
	});

	it('rejects junk', () => {
		expect(parseTimestamp('not a time')).toBeNull();
	});
});

describe('stripTags', () => {
	it('removes caption markup but keeps words', () => {
		const raw = 'hello<00:00:01.000><c> world</c> &amp; <i>friends</i>';
		expect(stripTags(raw)).toBe('hello world & friends');
	});

	it('collapses line breaks into spaces', () => {
		expect(stripTags('line one\nline two')).toBe('line one line two');
	});
});

describe('parseVtt', () => {
	it('skips the header and reads cue timings', () => {
		const cues = parseVtt(ROLLING_VTT);
		expect(cues).toHaveLength(4);
		expect(cues[0]).toEqual({ start: 0.16, end: 3.519, text: 'welcome to the course' });
	});

	it('ignores NOTE blocks', () => {
		const vtt = 'WEBVTT\n\nNOTE this is a comment\n\n00:00:01.000 --> 00:00:02.000\nhi\n';
		expect(parseVtt(vtt)).toEqual([{ start: 1, end: 2, text: 'hi' }]);
	});
});

describe('parseSrt', () => {
	it('parses whisper output', () => {
		const srt = '1\n00:00:00,000 --> 00:00:04,320\n This is a test.\n\n2\n00:00:04,320 --> 00:00:07,360\n Second line.\n';
		expect(parseSrt(srt)).toEqual([
			{ start: 0, end: 4.32, text: 'This is a test.' },
			{ start: 4.32, end: 7.36, text: 'Second line.' },
		]);
	});
});

describe('parseJson3', () => {
	it('joins segs and appends continuation events', () => {
		const json = JSON.stringify({
			events: [
				{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] },
				{ tStartMs: 2000, dDurationMs: 1500, aAppend: 1, segs: [{ utf8: ' again' }] },
				{ tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
			],
		});
		expect(parseJson3(json)).toEqual([{ start: 0, end: 3.5, text: 'hello world again' }]);
	});
});

describe('detectFormat', () => {
	it('prefers the file extension, then sniffs the body', () => {
		expect(detectFormat('{}', 'video.en.json3')).toBe('json3');
		expect(detectFormat('{}')).toBe('json3');
		expect(detectFormat('WEBVTT\n')).toBe('vtt');
		expect(detectFormat('1\n00:00:00,000 --> 00:00:01,000\nx')).toBe('srt');
		expect(parseSubtitles(ROLLING_VTT)).toHaveLength(4);
	});
});

describe('normalizeCues', () => {
	it('collapses rolling captions into one line', () => {
		const cues = normalizeCues(parseVtt(ROLLING_VTT));
		expect(cues).toHaveLength(1);
		expect(cues[0].text).toBe('welcome to the course today we build');
		expect(cues[0].start).toBeCloseTo(0.16, 3);
	});

	it('drops non-speech markers', () => {
		const cues = normalizeCues([
			{ start: 0, end: 1, text: '[Music]' },
			{ start: 1, end: 2, text: 'real words' },
			{ start: 2, end: 3, text: '[Applause]' },
		]);
		expect(cues).toEqual([{ start: 1, end: 2, text: 'real words' }]);
	});

	it('merges word-level overlap', () => {
		const cues = normalizeCues([
			{ start: 0, end: 2, text: 'the quick brown' },
			{ start: 2, end: 4, text: 'brown fox jumps' },
		]);
		expect(cues[0].text).toBe('the quick brown fox jumps');
	});

	it('keeps genuinely new cues apart', () => {
		const cues = normalizeCues([
			{ start: 0, end: 2, text: 'first idea' },
			{ start: 2, end: 4, text: 'second idea' },
		]);
		expect(cues).toHaveLength(2);
	});
});

describe('joinText', () => {
	it('adds a space for latin text but not for CJK', () => {
		expect(joinText('hello', 'world')).toBe('hello world');
		expect(joinText('你好', '世界')).toBe('你好世界');
		expect(joinText('hello', ', world')).toBe('hello, world');
	});
});

describe('buildParagraphs', () => {
	it('splits on long pauses', () => {
		const paragraphs = buildParagraphs([
			{ start: 0, end: 1, text: 'one' },
			{ start: 1.2, end: 2, text: 'two' },
			{ start: 10, end: 11, text: 'three' },
		]);
		expect(paragraphs).toEqual([
			{ start: 0, end: 2, text: 'one two' },
			{ start: 10, end: 11, text: 'three' },
		]);
	});

	it('splits very long blocks', () => {
		const paragraphs = buildParagraphs(
			[
				{ start: 0, end: 1, text: 'a'.repeat(300) },
				{ start: 1, end: 2, text: 'b'.repeat(300) },
			],
			{ maxChars: 400 }
		);
		expect(paragraphs).toHaveLength(2);
	});
});

describe('formatting', () => {
	it('formats timestamps with and without hours', () => {
		expect(formatTimestamp(75)).toBe('01:15');
		expect(formatTimestamp(3725)).toBe('1:02:05');
		expect(formatTimestamp(75, true)).toBe('0:01:15');
	});

	it('renders paragraphs with bold timestamps', () => {
		expect(renderTranscript([{ start: 0, end: 1, text: 'hi' }, { start: 61, end: 62, text: 'there' }])).toBe(
			'**[00:00]** hi\n\n**[01:01]** there'
		);
	});

	it('round-trips cues through srt', () => {
		const cues = [{ start: 1.5, end: 3.25, text: 'hello' }];
		expect(toSrt(cues)).toContain('00:00:01,500 --> 00:00:03,250');
		expect(parseSrt(toSrt(cues))).toEqual([{ start: 1.5, end: 3.25, text: 'hello' }]);
	});
});
