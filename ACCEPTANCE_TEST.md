# Acceptance Test - Final Gate

## Target URLs

1. https://zhuanlan.zhihu.com/p/2007944059558323475
2. https://x.com/i/status/2025986105485733945

## Pass Criteria

The project passes only when both URLs clip successfully.

For each URL, all conditions must be true:

1. The CLI exits with code `0`.
2. A Markdown file is generated.
3. The generated Markdown is non-empty and contains the page title and body.
4. The CLI JSON reports `ok: true` and the output file path.

## Command

```bash
npm run clip -- "<URL>" --output clips --wait networkidle --timeout-ms 60000
```

Convenience script for both URLs:

```bash
npm run clip:acceptance
```

## Final verification rule

Run the clip for URL #1 and URL #2. Final result = `PASS` only if both runs
satisfy every condition above.
