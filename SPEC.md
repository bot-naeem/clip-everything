# Obsidian Clipper CLI - Product Specification

## 1. Final Goal
Transform this repository from a browser-extension product into a CLI tool that:

1. Accepts a webpage URL as input.
2. Uses `openclaw browser` (with `openclaw` profile) to open and load the page.
3. Extracts page content and metadata from the live DOM.
4. Converts content to Markdown using reusable logic from this codebase.
5. Writes a local `.md` file with deterministic naming and optional frontmatter.

## 2. In Scope
- CLI-first workflow (`obsidian-clipper clip <url> ...`).
- Integration with `openclaw browser` commands (`start/open/wait/evaluate`).
- Reuse/refactor existing extraction + markdown pipeline where possible.
- Local file output and configurable output directory.
- Error handling, exit codes, logs, and tests for CLI path.

## 3. Out of Scope
- Browser extension UI (`popup`, `settings`, side panel, highlighter overlay UX).
- Manifest-based extension packaging and store publishing.
- Feature parity for all extension interactions on day one.

## 4. User-Facing Behavior
- Minimal command:
  - `obsidian-clipper clip https://example.com`
- Expected result:
  - Browser is controlled through OpenClaw profile.
  - Markdown file is generated in output directory.
  - CLI prints summary (url, title, file path, elapsed time).

Optional flags (MVP subset):
- `--output <dir>`
- `--filename <pattern>`
- `--frontmatter` / `--no-frontmatter`
- `--timeout-ms <n>`
- `--wait <load|domcontentloaded|networkidle>`
- `--profile <name>` (default: `openclaw`)

## 5. Technical Architecture (Target)
- `src/cli/`:
  - command parsing and process entry
  - orchestration pipeline
- `src/runtime/openclaw.ts`:
  - wrapper around OpenClaw commands
  - strongly typed command results + retries/timeouts
- `src/pipeline/clip.ts`:
  - end-to-end flow: open URL -> extract -> transform -> write file
- `src/core/` and `src/utils/`:
  - reused parsing/markdown/template logic (refactored to remove extension runtime assumptions)

## 6. Data Contract (MVP)
- `ClipInput`:
  - `url`, `title`, `html`, `meta`, `timestamp`
- `ClipOutput`:
  - `markdown`, `title`, `wordCount`, `outputPath`

## 7. Reliability Requirements
- Must work with `openclaw` profile where browser status is `running: true`.
- Browser actions are executed sequentially (avoid CDP session contention).
- Proper non-zero exit codes on failure.
- Error message includes failing stage (`open`, `wait`, `extract`, `write`).

## 8. Acceptance Criteria
- Given a valid URL, CLI produces one Markdown file successfully.
- Generated Markdown contains page title and extracted body text.
- CLI returns `0` on success, non-zero on failure.
- At least one end-to-end test validates URL -> `.md` output.
- README updated to CLI usage and migration notes.

## 9. Migration Strategy
- Keep extension code temporarily for incremental refactor.
- Introduce CLI modules first, then progressively decouple extension-only code.
- Remove extension packaging only after CLI path is stable and tested.
