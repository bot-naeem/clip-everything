# Acceptance Test - Final Gate

## Target URLs
1. https://zhuanlan.zhihu.com/p/2007944059558323475?share_code=wpShSwJIjJWb&utm_psn=2010112084201980758
2. https://x.com/i/status/2025986105485733945

## Pass Criteria
The project is considered finally passed only when both URLs can be clipped successfully by the CLI.

For each URL, all conditions below must be true:
1. CLI command exits with code `0`.
2. A Markdown file is generated.
3. Generated Markdown is non-empty and includes page title/content.
4. CLI output reports success with output file path.

## Suggested Command Shape
`obsidian-clipper clip "<URL>" --profile openclaw --wait networkidle`

## Final Verification Rule
Run clipping for URL #1 and URL #2.  
Final result = `PASS` only if both runs pass all criteria above.
