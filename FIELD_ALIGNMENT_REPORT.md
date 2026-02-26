# Field Alignment Report (Extension `ContentResponse` vs CLI Adapter)

## Scope
Comparison target:
- Extension source: `src/content.ts` `interface ContentResponse`
- CLI adapter source: `scripts/clip.js` `parseWithDefuddle()`

Status legend:
- `Equivalent`: same semantic source and usage
- `Approximate`: close, but not exactly the same derivation/runtime
- `Static Empty`: field kept for shape compatibility but currently fixed empty value

## Field-by-field

| Field | Extension (`getPageContent`) | CLI Adapter | Status | Notes |
|---|---|---|---|---|
| `content` | `defuddled.content` | `defuddled.content` | Equivalent | Same core source (`Defuddle`) |
| `selectedHtml` | real user selection HTML | `''` | Static Empty | CLI currently has no selection interaction |
| `extractedContent` | selector extraction map | `{}` | Static Empty | Kept for shape compatibility |
| `schemaOrgData` | `defuddled.schemaOrgData` | `defuddled.schemaOrgData` | Equivalent | Same source |
| `fullHtml` | cleaned `documentElement.outerHTML` | cleaned `rawHtml` with aligned cleaning order/rules | Equivalent | Cleaning sequence/rules aligned to `src/content.ts` |
| `highlights` | `highlighter.getHighlights()` | `[]` | Static Empty | CLI has no highlighter interaction |
| `title` | `defuddled.title` | `defuddled.title` fallback snapshot title | Equivalent | Same primary source |
| `description` | `defuddled.description` | `defuddled.description` | Equivalent | Same source |
| `domain` | `getDomain(document.URL)` | `getDomain(url)` from original `src/utils/string-utils.ts` | Equivalent | Reused original utility implementation |
| `favicon` | `defuddled.favicon` | `defuddled.favicon` | Equivalent | Same source |
| `image` | `defuddled.image` | `defuddled.image` | Equivalent | Same source |
| `parseTime` | `defuddled.parseTime` | `defuddled.parseTime` | Equivalent | Same source |
| `published` | `defuddled.published` | `defuddled.published` | Equivalent | Same source |
| `author` | `defuddled.author` | `defuddled.author` | Equivalent | Same source |
| `site` | `defuddled.site` | `defuddled.site` | Equivalent | Same source |
| `wordCount` | `defuddled.wordCount` | `defuddled.wordCount` | Equivalent | Same source |
| `metaTags` | `defuddled.metaTags` | `defuddled.metaTags` | Equivalent | Same source |

## Current Summary
- Equivalent: 15 fields
- Approximate: 0 fields
- Static Empty: 3 fields (`selectedHtml`, `extractedContent`, `highlights`)

## Optimization Priorities (No Feature Upgrade)
1. Keep static-empty fields unchanged unless we explicitly decide to replicate the same interaction capability in CLI mode.
