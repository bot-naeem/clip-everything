# CLAUDE.md

Guidance for working in this repository.

## Project overview

ClipEverything turns a URL into a Markdown note. It renders the page in a real
Chromium browser (Playwright), extracts the article with Defuddle (injected into
the page), and converts it to Markdown with the obsidian-clipper converter
(with Turndown as a fallback).

Derived from [obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper).
The `src/utils/` directory holds the three vendored files the CLI actually needs
(`markdown-converter.ts`, `string-utils.ts`, `debug.ts`); everything else from the
extension was removed.

## Commands

```bash
npm install                 # install deps
npm run install-browser     # only if neither Chrome nor Edge is present
npm run clip -- <url>       # clip one page -> ./clips/<title>.md
npm run clip -- --video <url>       # transcribe a video -> ./clips/<title>.md
npm run setup:video         # yt-dlp + ffmpeg + whisper.cpp + model (~600 MB)
npm run login -- --profile <name>   # visible browser, saves cookies on close
npm test                    # vitest (tests/)
npm run test:watch
```

Quick manual check:

```bash
npm run clip -- "https://example.com" --no-frontmatter
npm run clip -- "https://zhuanlan.zhihu.com/p/123" --headed
```

## Architecture

```
scripts/clip.js            CLI entry: parse -> launch -> navigate -> extract -> transform -> write
scripts/transcribe.js      --video entry: probe -> captions or whisper -> markdown
scripts/login.js           opens a visible persistent profile and waits for you to close it
scripts/setup-video.js     downloads yt-dlp, ffmpeg, whisper.cpp and a ggml model
scripts/lib/args.js        flag parsing, profile dir resolution (pure, tested)
scripts/lib/video-args.js  --video flag parsing, proxy detection (pure, tested)
scripts/lib/browser.js     playwright-core launch (persistent profile, channel fallback), navigation
scripts/lib/extract.js     Defuddle injection + generic/fallback extractors (page functions)
scripts/lib/sites.js       site adapters: { id, match, ready?, extract? }
scripts/lib/markdown.js    obsidian-clipper converter bridge (ts-node) + Turndown fallback
scripts/lib/naming.js      filename sanitising, token rendering, unique paths, getDomain
scripts/lib/frontmatter.js YAML block (pages and video notes)
scripts/lib/media/tools.js    locate yt-dlp/ffmpeg/whisper + models (env overrides)
scripts/lib/media/ytdlp.js    probe, caption download, audio download
scripts/lib/media/whisper.js  ffmpeg -> 16 kHz wav -> whisper-cli
scripts/lib/media/subtitles.js VTT/JSON3/SRT parsing, rolling-caption dedupe, paragraphs
scripts/lib/errors.js      StageError(stage, message, cause)
tests/                     vitest specs for the libs
src/utils/                 vendored obsidian-clipper converter (markdown-converter, string-utils, debug)
```

## Publishing

`package.json` declares `bin: { "clip-everything": "scripts/clip.js" }` and a
`files` allowlist (`scripts/`, `src/`, READMEs, LICENSE), so `npx clip-everything`
works and `src/utils/*.ts` ships with the package — it is loaded at runtime by
ts-node. `prepublishOnly` runs the test suite.

`typescript` must stay in `dependencies` (not devDependencies): ts-node requires
it at runtime, and npm does not install a package's devDependencies for consumers.

## Video pipeline

`scripts/transcribe.js` is a second entry point behind `clip --video`. It does not
use Playwright; it shells out to yt-dlp (metadata, captions, audio) and to
ffmpeg + whisper.cpp (speech-to-text). Stages are `start`, `download`,
`transcribe`, `write`.

- Binaries live in `~/.clip-everything/bin` and can be overridden with `CLIP_YTDLP`,
  `CLIP_FFMPEG`, `CLIP_FFPROBE`, `CLIP_WHISPER` and `CLIP_WHISPER_MODEL`.
- Caption formats (json3, vtt, srt) all funnel through `parseSubtitles()` and then
  `normalizeCues()`. Auto captions repeat the previous line, so dedupe is not
  optional — keep it covered by `tests/subtitles.test.js`.
- YouTube walls anonymous datacenter/proxy IPs behind a login check; `probeWithAuth`
  retries with cookies from an installed browser before failing. `--profile <name>`
  reuses the `cookies.txt` that `login` exports, which avoids the browser's locked
  cookie database entirely.
- `--proxy auto` probes common local ports (7890, 7897, 10809, 1080) and only uses
  one that is actually listening.

## Conventions

- **Page functions are serialized by Playwright.** Functions in `sites.js` and the
  extractors in `extract.js` run inside the browser, so they must be
  self-contained: no imports, no closures over module state, no `require`.
- **stdout is a single JSON document.** Warnings go to stderr, errors go to stderr
  as `{ ok: false, stage, error }` with exit code 1.
- **Stages are stable**: `start`, `navigate`, `wait`, `extract`, `transform`, `write`.
  Wrap failures in `StageError` so callers can branch on `stage`.
- **Never overwrite a note.** `writeMarkdownFile` adds ` 1`, ` 2`, … via `uniquePath`.
- **Do not pass large payloads through argv.** Windows caps the command line at
  ~32k; use stdin or `page.evaluate`.

## Adding a site adapter

Add an entry to `scripts/lib/sites.js`:

```js
{
  id: 'example-post',
  match(url) { return /(^|\.)example\.com$/.test(url.hostname); },
  ready() { return document.querySelectorAll('article p').length >= 3; }, // optional
  extract() {                                                             // optional
    const root = document.querySelector('article');
    if (!root) return { __error: 'no article' };
    return { content: root.outerHTML, title: document.title, url: location.href, text: root.innerText };
  },
}
```

`extract` returning `{ __error }` or throwing makes the pipeline fall through to
the Defuddle extractor, then to the plain-DOM fallback. Add a spec in
`tests/lib.test.js` for `findHandler`.

## Notes

- `defuddle` ships as a UMD bundle; `require.resolve('defuddle')` gives the file
  injected into the page. It is injected with `page.evaluate(bundle)` (CDP, bypasses
  CSP) with `addScriptTag` as a fallback.
- `ts-node` compiles `src/utils/*.ts` at runtime. Node >= 21 defines a read-only
  `navigator` global, so DOM globals are installed via `Object.defineProperty`
  (see `installDomGlobals`).
