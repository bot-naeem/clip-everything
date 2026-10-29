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

Profiles live in `~/.clip-everything/profiles/<name>`. Run once with `--headed`, log in, close the browser; later runs reuse the cookies:

```bash
npm run clip -- "https://x.com/i/status/123" --headed --profile x
```

Use `--no-persist` for one-off anonymous clips.

## Development

```bash
npm test           # vitest: tests/ (CLI libs)
npm run test:watch
```

| Path | Purpose |
| --- | --- |
| `scripts/clip.js` | CLI entry: orchestration + JSON output |
| `scripts/lib/` | args, browser, extract, sites, markdown, naming, frontmatter |
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

## License

MIT
