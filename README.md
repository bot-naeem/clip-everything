# Obsidian Clipper CLI

A CLI tool that clips web pages to Markdown files using `openclaw browser`.

中文文档: [README.zh-CN.md](./README.zh-CN.md)

## What It Does

Given a URL, the CLI will:

1. Ensure an OpenClaw browser profile is running.
2. Open the target page.
3. Extract main content.
4. Convert to Markdown (reusing the original converter pipeline).
5. Save a local `.md` file to your output directory.

## Prerequisites

- Node.js 18+
- npm
- OpenClaw CLI installed and available in PATH (`openclaw`)
- A working OpenClaw browser profile (default: `openclaw`)

## Installation (Step by Step)

### 1. Install Node.js

Make sure Node.js is available:

```bash
node -v
npm -v
```

If these commands fail, install Node.js 18+ first.

### 2. Install OpenClaw CLI

Install OpenClaw CLI by following the official guide:

- https://docs.openclaw.ai/cli/browser

Then verify:

```bash
openclaw --help
```

### 3. Start OpenClaw browser profile

```bash
openclaw browser --browser-profile openclaw start --json
```

Check status:

```bash
openclaw browser --browser-profile openclaw status --json
```

### 4. Install project dependencies

```bash
npm ci
```

## Quick Start

Clip one page:

```bash
npm run clip -- "https://example.com"
```

Output defaults to `./clips`.

Configure output directory:

```bash
npm run clip -- "https://example.com" --output "/Users/yourname/obsidian"
```

## CLI Usage

```bash
npm run clip -- <url> [options]
```

Options:

- `--output <dir>`: Output directory (default: `clips`)
- `--filename <pattern>`: Output filename pattern (default: `{title}`)
- `--profile <name>`: OpenClaw browser profile (default: `openclaw`)
- `--wait <load|domcontentloaded|networkidle>`: Browser load mode (default: `networkidle`)
- `--timeout-ms <n>`: Timeout in milliseconds (default: `30000`)
- `--frontmatter`: Include YAML frontmatter (default: enabled)
- `--no-frontmatter`: Disable YAML frontmatter

Filename tokens:

- `{title}`
- `{domain}`
- `{date}`
- `{time}`

Example:

```bash
npm run clip -- "https://zhuanlan.zhihu.com/p/2007944059558323475" \
  --output clips \
  --filename "{date}-{title}" \
  --profile openclaw \
  --timeout-ms 30000
```

## Output

On success, the CLI prints JSON like:

```json
{
  "ok": true,
  "url": "https://example.com",
  "title": "Example",
  "outputPath": "/abs/path/clips/Example.md",
  "contentLength": 1234,
  "converterUsed": "original-createMarkdownContent",
  "elapsedMs": 4567
}
```

## Acceptance Test

Run the built-in acceptance script:

```bash
npm run clip:acceptance
```

Run Zhihu-specific acceptance (zhuanlan + answer + quality checks):

```bash
npm run clip:zhihu-acceptance
```

## Notes

- The project now targets a stable CLI clipping workflow.
- Browser extension build scripts remain in the repository for compatibility, but the primary supported path here is CLI clipping.

## Troubleshooting

If clipping fails:

1. Confirm OpenClaw is running: `openclaw browser --browser-profile openclaw status --json`
2. Restart OpenClaw browser:
   `openclaw browser --browser-profile openclaw stop --json`
   `openclaw browser --browser-profile openclaw start --json`
3. Increase timeout, e.g. `--timeout-ms 60000`
4. Retry with `--wait domcontentloaded`
# ClipEverything
