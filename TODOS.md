# TODOs - Obsidian Clipper CLI Migration

## Phase 0 - Baseline and Safety
- [ ] Freeze current baseline: run tests and record failures/snapshots.
- [ ] Add `SPEC.md` and keep it as source of truth.
- [ ] Define MVP success metric: one URL -> one valid `.md` file.

## Phase 1 - CLI Skeleton
- [ ] Add CLI entrypoint (`src/cli.ts` or `src/bin/clipper.ts`).
- [ ] Add command parser and `clip` command.
- [ ] Wire npm scripts for build/run CLI.
- [ ] Add basic structured logging and exit code mapping.

## Phase 2 - OpenClaw Integration
- [ ] Implement `openclaw` command wrapper module.
- [ ] Support profile selection (default `openclaw`).
- [ ] Implement sequential browser flow:
  - [ ] ensure/start browser
  - [ ] open URL
  - [ ] wait for load state
  - [ ] evaluate DOM payload
- [ ] Add robust timeout/retry handling.

## Phase 3 - Extraction and Markdown Pipeline
- [ ] Define `ClipInput` and `ClipOutput` types.
- [ ] Refactor reusable extraction utilities away from extension-only APIs.
- [ ] Build transformation pipeline:
  - [ ] raw DOM/meta -> extracted content
  - [ ] extracted content -> markdown
  - [ ] markdown -> file output
- [ ] Implement filename sanitization and collision policy.

## Phase 4 - Config and UX
- [ ] Add config file support (default path + override).
- [ ] Add flags:
  - [ ] `--output`
  - [ ] `--filename`
  - [ ] `--frontmatter`
  - [ ] `--timeout-ms`
  - [ ] `--wait`
  - [ ] `--profile`
- [ ] Print concise run summary to stdout.

## Phase 5 - Testing
- [ ] Keep existing unit tests green for reusable modules.
- [ ] Add CLI unit tests (argument parsing, path logic, error mapping).
- [ ] Add end-to-end test:
  - [ ] input URL
  - [ ] run clip command
  - [ ] verify output `.md` file exists and content is non-empty
- [ ] Add fixture-based tests to reduce network flakiness.

## Phase 6 - Cleanup and Release
- [ ] Update README from extension docs to CLI docs.
- [ ] Add migration notes for users.
- [ ] Decide deprecation/removal path for extension-specific modules.
- [ ] Final regression run and release checklist.
