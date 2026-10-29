# scripts

| File | Purpose |
| --- | --- |
| `clip.js` | CLI entry point (see `scripts/lib/` for the pipeline modules) |
| `lib/args.js` | Flag parsing, profile/timer defaults |
| `lib/browser.js` | Playwright launch, channel fallback, navigation |
| `lib/extract.js` | Defuddle injection, generic + fallback extractors, wall detection |
| `lib/sites.js` | Per-site adapters (Zhihu answer/zhuanlan, X status) |
| `lib/markdown.js` | obsidian-clipper converter bridge + Turndown fallback |
| `lib/naming.js` | Filename sanitising, token rendering, unique paths |
| `lib/frontmatter.js` | YAML frontmatter |
| `lib/errors.js` | `StageError` |
| `acceptance.js` | Cross-platform acceptance run (`npm run clip:acceptance`) |
| `acceptance-test.sh` | Same, POSIX shell |
| `zhihu-acceptance.sh` | Zhihu-specific run + quality checks |
| `zhihu-quality-check.js` | Asserts a clipped Zhihu note has no UI noise |

Unit tests for the `lib/` modules live in `../tests/`.
