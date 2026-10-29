# scripts

| File | Purpose |
| --- | --- |
| `clip.js` | CLI entry point (see `scripts/lib/` for the pipeline modules) |
| `transcribe.js` | `--video` entry point: probe → captions or whisper → Markdown |
| `login.js` | Opens a visible browser to sign in, saves cookies to the profile |
| `setup-video.js` | Downloads yt-dlp, ffmpeg, whisper.cpp and a ggml model |
| `lib/args.js` | Flag parsing, profile/timer defaults |
| `lib/video-args.js` | `--video` flag parsing, local proxy detection |
| `lib/browser.js` | Playwright launch, channel fallback, navigation |
| `lib/extract.js` | Defuddle injection, generic + fallback extractors, wall detection |
| `lib/sites.js` | Per-site adapters (Zhihu answer/zhuanlan, X status) |
| `lib/markdown.js` | obsidian-clipper converter bridge + Turndown fallback |
| `lib/naming.js` | Filename sanitising, token rendering, unique paths |
| `lib/frontmatter.js` | YAML frontmatter (pages and video notes) |
| `lib/media/tools.js` | Locate yt-dlp/ffmpeg/whisper and models |
| `lib/media/ytdlp.js` | Probe, caption download, audio download |
| `lib/media/whisper.js` | ffmpeg → 16 kHz wav → whisper-cli |
| `lib/media/subtitles.js` | VTT/JSON3/SRT parsing, caption dedupe, paragraphs |
| `lib/errors.js` | `StageError` |
| `acceptance.js` | Cross-platform acceptance run (`npm run clip:acceptance`) |
| `acceptance-test.sh` | Same, POSIX shell |
| `zhihu-acceptance.sh` | Zhihu-specific run + quality checks |
| `zhihu-quality-check.js` | Asserts a clipped Zhihu note has no UI noise |

Unit tests for the `lib/` modules live in `../tests/`.
