# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClipEverything - CLI tool to clip web pages to Markdown files. Uses OpenClaw browser for automated clipping.

This project is derived from obsidian-clipper.

## Common Commands

```bash
# Clip a URL to Markdown
npm run clip -- "https://example.com" --output "clips"

# With custom filename pattern
npm run clip -- "https://example.com" --output "clips" --filename "{date}-{title}"

# Run tests
npm run test
npm run test:watch
```

### CLI Options

- `--output <dir>` - Output directory (default: `clips`)
- `--filename <pattern>` - Filename pattern (default: `{title}`)
- `--profile <name>` - OpenClaw profile (default: `openclaw`)
- `--wait <load|domcontentloaded|networkidle>` - Wait strategy (default: `networkidle`)
- `--timeout-ms <n>` - Timeout in milliseconds (default: 30000)
- `--no-frontmatter` - Disable YAML frontmatter

### Filename Pattern Tokens

`{title}`, `{domain}`, `{date}`, `{time}`

## Architecture

- **CLI Entry**: `scripts/clip.js`
- **Core Utils**: `src/utils/` - Content extraction, Markdown conversion, parsing
- **Filters**: `src/utils/filters/` - Variable transformation filters

### Key Modules

- `src/utils/markdown-converter.ts` - HTML to Markdown using Turndown
- `src/utils/parser.ts` - Template variable parsing
- `src/utils/tokenizer.ts` - Template tokenization
- `src/utils/content-extractor.ts` - Main content extraction

## Prerequisites

1. OpenClaw CLI installed (`openclaw` in PATH)
2. OpenClaw browser profile running:
   ```bash
   openclaw browser --browser-profile openclaw start --json
   ```
