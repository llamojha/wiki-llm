# Markdown Sanitization Audit

Pipeline: `remark-parse` → `remark-gfm` → `remark-rehype` → `rehype-slug` → `rehype-sanitize` → `rehype-stringify`

Schema: **GitHub-style default** from `hast-util-sanitize@5.0.2` (no custom overrides).

## Allowed Tags

| Category | Tags |
|---|---|
| Headings | `h1` `h2` `h3` `h4` `h5` `h6` |
| Block | `p` `blockquote` `pre` `div` `hr` `details` `summary` `section` |
| Inline | `a` `b` `strong` `em` `i` `code` `kbd` `samp` `var` `span` `sub` `sup` `q` |
| Lists | `ol` `ul` `li` `dl` `dt` `dd` |
| Tables | `table` `thead` `tbody` `tfoot` `tr` `th` `td` |
| Media | `img` `picture` `source` |
| Formatting | `br` `del` `s` `strike` `ins` `tt` `rp` `rt` `ruby` |
| Task lists | `input` (checkbox only, forced `disabled`) |

## Stripped (content preserved, tag removed)

`script` — content is kept but the tag is removed.

All other unlisted tags are **dropped entirely** (tag and content removed).

## Key Attribute Rules

| Attribute | Scope | Notes |
|---|---|---|
| `href` | `<a>` | Protocols: `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp` |
| `src` | `<img>` | Protocols: `http`, `https` |
| `className` | `<code>` | Only `language-*` pattern (for syntax highlighting) |
| `id` | all | Prefixed with `user-content-` to prevent DOM clobbering |
| `name` | all | Prefixed with `user-content-` to prevent DOM clobbering |

## What Is Blocked

- `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>` — not in allowed tags
- Event handler attributes (`onclick`, `onerror`, etc.) — not in allowed attributes
- `javascript:` protocol URIs — not in allowed protocols
- `data:` URIs — not in allowed protocols
- `style` attribute — not in allowed attributes (no inline CSS injection)

## dangerouslySetInnerHTML Usage

| File | Source | Safe? |
|---|---|---|
| `components/doc-reader.tsx` | `liveDoc._html` — branded `SanitizedHtml` type, produced only by `renderMarkdown()` | ✅ |
| `app/layout.tsx` (script) | `themeBootstrapScript()` — developer template; the only interpolated data is the server-side theme registry (operator files on disk), JSON-encoded with `<` escaped | ✅ |
| `app/layout.tsx` (style) | Theme plugin CSS from `lib/theme-registry.ts` — operator-controlled files on the server's disk (same trust level as the codebase), never user/vault content; `</` is neutralized so the `<style>` tag cannot be closed early | ✅ |

## Editor Preview

`lib/markdown-preview.tsx` renders via React elements (no `innerHTML`). Safe by construction.

## Conclusion

All user-authored Markdown passes through `rehype-sanitize` with the GitHub-style default schema before reaching the DOM. No custom schema overrides weaken the defaults. The branded `SanitizedHtml` type enforces at compile time that only sanitized output is used with `dangerouslySetInnerHTML`.
