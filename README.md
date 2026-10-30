# ClipEverything

Clip any web page into a clean Markdown note — using a **real browser**, not a plain HTTP fetch.

Derived from [obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper). The output is Obsidian-friendly: YAML frontmatter, an `# H1` title, then the article body with tables, code blocks, footnotes and images preserved.

中文文档: [README.zh-CN.md](./README.zh-CN.md)

## Why a real browser

`fetch` + readability works for static blogs and fails everywhere else. ClipEverything drives Chromium (via Playwright) so it can handle:

- JavaScript-rendered pages (SPAs, infinite scroll, lazy images)
- login-gated content — cookies persist across runs
- sites that only render the article after hydration (Zhihu, X/Twitter)
- pages that block headless HTTP clients

The rendered DOM is then handed to [Defuddle](https://github.com/kepano/defuddle) for article extraction and to the original obsidian-clipper converter for Markdown.

## Requirements

- Node.js 18+
- A Chromium-family browser. **Chrome or Edge is auto-detected**, so most machines need nothing extra.
- Only if you have neither: `npm run install-browser` (downloads Chromium).
- For `--video` only: `npm run setup:video` (yt-dlp, ffmpeg, whisper.cpp + model, ~600 MB).

## Install

Nothing to install — run it with `npx`:

```bash
npx clip-everything "https://example.com/article"
```

Or install it globally:

```bash
npm install -g clip-everything
clip-everything "https://example.com/article"
```

From source:

```bash
git clone git@github.com:bot-naeem/clip-everything.git
cd clip-everything
npm install
npm run clip -- "https://example.com/article"
```

## Quick start

```bash
npm run clip -- "https://example.com/article"
```

Output defaults to `./clips`, filename defaults to the page title. On success the CLI prints JSON:

```json
{
  "ok": true,
  "url": "https://example.com/article",
  "title": "Example",
  "outputPath": "C:\\work\\clips\\Example.md",
  "contentLength": 4821,
  "converterUsed": "obsidian-converter",
  "extractor": "defuddle",
  "browser": "msedge",
  "warnings": [],
  "elapsedMs": 3920
}
```

On failure it prints JSON to **stderr** with `ok: false`, a `stage` (`start` / `navigate` / `extract` / `transform` / `write`) and exits with code `1`. Warnings never pollute stdout, so `clip.js` output stays machine-readable.

## CLI

```
npm run clip -- <url> [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `--output <dir>`, `-o` | `./clips` | Output directory |
| `--filename <pattern>` | `{title}` | Filename template, tokens below |
| `--profile <name>` | `default` | Browser profile name (keeps cookies/logins) |
| `--profile-dir <dir>` | `~/.clip-everything/profiles/<name>` | Explicit profile directory |
| `--no-persist` | off | Throwaway context, no saved cookies |
| `--wait <mode>` | `networkidle` | `load` \| `domcontentloaded` \| `networkidle` |
| `--timeout-ms <n>` | `30000` | Navigation timeout |
| `--browser <name>` | `auto` | `auto` \| `chromium` \| `chrome` \| `msedge` |
| `--headed` | off | Show the browser window |
| `--no-frontmatter` | off | Omit the YAML block |
| `--video <url>` | off | Transcribe a video instead of clipping a page (see below) |
| `--help`, `--version` | | |

Filename tokens: `{title}` `{domain}` `{date}` `{time}` (local time, `YYYY-MM-DD`).

```bash
# into an Obsidian vault, dated filenames
npm run clip -- "https://zhuanlan.zhihu.com/p/123" -o ~/vault/inbox --filename "{date}-{title}"

# login-gated site: log in once in a visible window, cookies are kept
npm run clip -- "https://x.com/user/status/123" --headed

# a page that never reaches networkidle
npm run clip -- "https://example.com" --wait domcontentloaded --timeout-ms 60000
```

## How it works

```
url
 └─ playwright-core
     ├─ launch Chrome/Edge/Chromium (persistent profile keeps logins)
     ├─ goto(url) with --wait strategy, degrades networkidle → domcontentloaded
     ├─ waitForFunction(ready heuristic)   ← per-site, time-boxed, non-fatal
     ├─ evaluate: inject Defuddle bundle, run site adapter or generic extractor
     └─ evaluate: fallback DOM extractor if Defuddle fails
 └─ markdown
     ├─ obsidian-clipper converter (src/utils/markdown-converter.ts, via ts-node)
     └─ Turndown + GFM as fallback
 └─ write {filename}.md, never overwriting (adds " 1", " 2", …)
```

The Defuddle bundle is injected through CDP `Runtime.evaluate`, which is not blocked by page CSP — no `<script>` tag, no 32k command-line limit, so it works on Windows too.

## Site adapters

`scripts/lib/sites.js` holds small handlers that override the generic extractor:

| Adapter | Handles |
| --- | --- |
| `zhihu-answer` | `zhihu.com/question/*` — rendered answer body, waits for hydration |
| `zhihu-zhuanlan` | `zhuanlan.zhihu.com/p/*` — `[itemprop=articleBody]`, strips column/footer noise |
| `x-status` | `x.com|twitter.com/*/status/*` — tweet article root for the fallback extractor |

Everything else goes through Defuddle, with a plain-DOM fallback. Adding a site means adding one `{ id, match, ready?, extract? }` object — no changes to the pipeline.

## Login-gated pages

Profiles live in `~/.clip-everything/profiles/<name>`. Sign in once with the
`login` command — it opens a visible browser and saves the session when you close
the window:

```bash
npm run login -- --profile zhihu            # opens https://www.zhihu.com
npm run login -- --profile x --url https://x.com
```

Then reuse that profile:

```bash
npm run clip -- "https://zhuanlan.zhihu.com/p/123" --profile zhihu
npm run clip -- "https://x.com/user/status/123" --profile x
```

Use `--no-persist` for one-off anonymous clips.

The login command also exports `cookies.txt` into the profile directory. That is
what the video pipeline reads — yt-dlp cannot read Chromium's cookie database
while the browser is running, but a `cookies.txt` works any time:

```bash
npm run login -- --profile youtube --url https://www.youtube.com
npm run clip -- --video "https://www.youtube.com/watch?v=..." --profile youtube
```

If a site serves a captcha or login wall, the CLI stops with
`site returned a wall instead of content` and tells you to sign in — it will not
write a bogus note.

## Video → transcript

`--video` turns a talk, lecture or course video into a timestamped Markdown note.
It skips the browser entirely: yt-dlp downloads the captions, or the audio when
there are none, and whisper.cpp transcribes it.

```bash
npm run setup:video                                   # one-time, ~600 MB
npm run clip -- --video "https://www.youtube.com/watch?v=..."
npm run clip -- --video "https://www.youtube.com/watch?v=..." --login   # sign in once, then transcribe
npm run clip -- --video "https://www.bilibili.com/video/BV..." --lang zh --save-srt
```

The note looks like this:

```markdown
---
title: "How great leaders inspire action"
source: "https://www.youtube.com/watch?v=qp0HIF3SfI4"
author: "TED"
site: "YouTube"
published: "2010-05-04"
duration: "17:47"
language: "en"
transcript: "auto captions (en)"
---
# How great leaders inspire action

> TED · 17:47 · auto captions (en)
> https://www.youtube.com/watch?v=qp0HIF3SfI4

## Chapters

- [00:00] Intro

## Transcript

**[00:00]** how do you explain when things don't go as we assume...
```

Route selection, in order:

1. manual captions matching `--lang`
2. automatic captions matching `--lang`
3. speech-to-text with `--whisper-model` (default `small`)

**GPU and larger models (optional).** The whisper.cpp release is CPU-only. If you
have an NVIDIA GPU, `--whisper-backend faster` runs
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) instead, which takes
`large-v3` and friends at a fraction of the wall time:

```bash
python -m pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12
set CLIP_PYTHON=C:\path\to\python.exe            # only if python is not on PATH
set CLIP_FASTER_WHISPER_MODEL=D:\models\large-v3  # model dir, or a HF repo id
npm run clip -- --video "<url>"
```

`--whisper-backend auto` (the default) switches to faster-whisper as soon as
`CLIP_FASTER_WHISPER_MODEL` is set, and stays on whisper.cpp otherwise.
`CLIP_FASTER_WHISPER_DEVICE` (`cuda`/`cpu`) and `CLIP_FASTER_WHISPER_COMPUTE`
(`float16`/`float32`/`int8_float16`) tune the run; Pascal cards (GTX 10x0) fall
back to `float32` automatically because they cannot do efficient float16.

The CUDA libraries are found automatically when they come from the
`nvidia-*-cu12` wheels.

Rather than exporting variables in every shell, put the settings in
`~/.clip-everything/config.json`:

```json
{
  "whisper": {
    "backend": "faster",
    "python": "C:\\Python311\\python.exe",
    "model": "D:\\models\\large-v3",
    "device": "cuda",
    "compute": "float32"
  }
}
```

Precedence is CLI flag, then environment variable, then this file.

Models can be fetched without Hugging Face:

```bash
# from ModelScope, one file at a time
curl -L -o model.bin "https://www.modelscope.cn/api/v1/models/pengzhendong/faster-whisper-large-v3-turbo/repo?Revision=master&FilePath=model.bin"
```

Measured on an i7-7700 + GTX 1080 Ti, 40:43 of lecture audio: whisper.cpp `small`
took 810 s, faster-whisper `large-v3-turbo` took 150 s (about 16x realtime).

**Whole playlists.** `--playlist` expands a course playlist, writes one note per
video, and drops a `00-Index.md` next to them. A failed video is recorded in the
index instead of aborting the run:

```bash
npm run clip -- --video "https://www.youtube.com/playlist?list=..." --playlist --profile youtube
npm run clip -- --video "https://www.youtube.com/playlist?list=..." --playlist --limit 3
```

YouTube's rolling auto-captions (each cue repeats the previous one) are collapsed
before the text is grouped into paragraphs on pauses longer than 2.5 s, so the
note reads like prose instead of one line per cue. `--save-srt` writes the
cleaned cues next to the note.

| Option | Default | Description |
| --- | --- | --- |
| `--lang <codes>` | `zh-Hans,zh-CN,zh,en` | Subtitle language preference |
| `--whisper-model <name>` | `small` | `tiny` \| `base` \| `small` \| `medium` \| `large-v3` |
| `--whisper-backend <name>` | `auto` | `auto` \| `cpp` (whisper.cpp) \| `faster` (GPU) |
| `--whisper-timeout-ms <n>` | max(1h, 8x audio) | Speech-to-text time budget |
| `--no-whisper` | off | Fail instead of falling back to speech-to-text |
| `--force-whisper` | off | Ignore captions and transcribe the audio |
| `--save-srt` | off | Also write `<name>.srt` |
| `--keep-audio` | off | Keep the downloaded audio next to the note |
| `--proxy <url>` / `--no-proxy` | auto-detect local | Proxy for yt-dlp |
| `--cookies-from-browser <name>` | off | Reuse a browser session (`edge`, `chrome`, `firefox`) |
| `--cookies <file>` | off | Netscape `cookies.txt` |
| `--profile <name>` | off | Use the `cookies.txt` exported by `npm run login -- --profile <name>` |
| `--login` | off | Open a browser to sign in for this site, then continue |
| `--playlist` | off | Transcribe every video in a playlist URL |
| `--limit <n>` | all | With `--playlist`, stop after `n` videos |
| `--threads <n>` | CPU count - 1 | whisper.cpp threads |
| `--timeout-ms <n>` | `600000` | Network step timeout (downloads, metadata) |

Three practical notes:

- **YouTube bot wall.** Anonymous requests from datacenter or proxy IPs often get
  `Sign in to confirm you're not a bot`. The shortest path is one command:
  `npm run clip -- --video "<url>" --login`. It opens a browser, saves the session
  to `~/.clip-everything/profiles/youtube/cookies.txt`, and carries on. Later runs
  can reuse it with `--profile youtube`.
- **Browser cookie databases are not a shortcut any more.** Edge/Chrome 127+
  encrypt cookies with an app-bound key, so `--cookies-from-browser edge` fails
  with `Failed to decrypt with DPAPI`, and a running browser locks the file anyway.
  Use `--login` (or a `cookies.txt` exported by an extension, via `--cookies`).
- **JavaScript runtime.** YouTube needs a JS runtime to solve its `n` challenge.
  ClipEverything passes the Node executable that is running the CLI to yt-dlp
  automatically; override with `CLIP_JS_RUNTIME=deno`, or disable with
  `CLIP_JS_RUNTIME=none`.
- **Speed.** `small` runs on CPU at roughly 1/5–1/2 of realtime; `medium` is more
  accurate and about 3× slower. Captions, when present, are instant.

## Development

```bash
npm test           # vitest: tests/ (CLI libs)
npm run test:watch
```

| Path | Purpose |
| --- | --- |
| `scripts/clip.js` | CLI entry: orchestration + JSON output |
| `scripts/transcribe.js` | `--video` pipeline: probe → captions or whisper → Markdown |
| `scripts/lib/` | args, browser, extract, sites, markdown, naming, frontmatter |
| `scripts/lib/media/` | yt-dlp, ffmpeg and whisper wrappers + subtitle parser |
| `tests/` | unit tests for the CLI helpers |
| `src/utils/` | vendored obsidian-clipper converter (3 files): `markdown-converter.ts`, `string-utils.ts`, `debug.ts` |

## Migrating from 1.x (OpenClaw)

1.x shelled out to `openclaw browser`. That dependency is gone:

| 1.x | 2.x |
| --- | --- |
| `--profile openclaw` | `--profile <name>` (browser profile, default `default`) |
| requires `openclaw` CLI running | requires nothing but a browser |
| `openclaw browser … --json` | Playwright API |
| `npm run clip -- <url> --profile openclaw` | `npm run clip -- <url>` |

Also fixed: `defuddle` and `ts-node` are real dependencies now (a clean `npm ci` used to fail), and the isolated converter no longer passes HTML through argv (Windows' 32k limit).

## Troubleshooting

**Windows PowerShell: `npm : 无法加载文件 …npm.ps1，因为在此系统上禁止运行脚本`**

The default PowerShell execution policy blocks npm's `.ps1` shim. Use the `.cmd`
shim instead:

```powershell
npm.cmd run clip -- "https://example.com"
```

Or allow locally created scripts once (per user, no admin needed):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**`site returned a wall instead of content`**

The page is behind a login or captcha. Sign in once with `npm run login -- --profile <name>`
and clip with the same `--profile`.

**Video: `Sign in to confirm you're not a bot`**

YouTube blocks anonymous requests from many proxy/datacenter IPs. Add `--login`:

```bash
npm run clip -- --video "<url>" --login
```

Sign in in the window, close it, and the transcript continues automatically.
Later runs reuse the saved session with `--profile youtube`.

**Video: `Requested format is not available`**

yt-dlp could not solve YouTube's JavaScript challenge. ClipEverything passes the
running Node executable automatically; if it still happens, check `node --version`
(20+) or set `CLIP_JS_RUNTIME=node:C:\path\to\node.exe`. `CLIP_JS_RUNTIME=none`
turns the flag off for custom yt-dlp builds.

**Video: `Failed to decrypt with DPAPI`**

Edge/Chrome 127+ encrypt cookies with an app-bound key that yt-dlp cannot read.
Use `--login` instead of `--cookies-from-browser`, or export a `cookies.txt` with
a browser extension and pass `--cookies <file>`.

**The clip waits ~30s then warns `networkidle never settled`**

Some pages keep a long-lived connection open. Pass `--wait domcontentloaded`.

## License

MIT
