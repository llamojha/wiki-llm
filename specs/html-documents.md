# First-class HTML documents

> **Status**: IMPLEMENTED (2026-07-05, branch `feat/folders-first-vault-mode`).
> `.html` is now surfaced by the listing choke point, rendered via
> `renderHtmlDocument`, given derived metadata (title/LastModified/`uploaded`),
> indexed/searched via `htmlText`, agent-readable, and upload-accepted. A single
> shared in-vault link resolver (`web/lib/vault-links.ts`) serves both the
> Markdown and HTML pipelines. **Deferred (spec §10)**: external-image proxy,
> inline-`style` allowlist, `data:` image URIs, and HTML authoring in the portal.
>
> **Sibling security boundaries**: cite plan 002 (document-key allowlist) and
> plan 005 (upload size limit) — HTML inherits both.

## Why

The maintainer wants vaults to hold HTML documents with the same standing as
Markdown — uploaded, browsed, searched, cited by the agent. Today `.html` is
invisible end-to-end: the S3 listing layer is hard-filtered to `.md`, upload
rejects non-`.md`, and the render pipeline assumes Markdown. HTML is also the
repo's **most guarded** surface (rendered HTML is where XSS lives), and one
existing guarantee depends on *no write path ever creating a non-`.md` key* —
so this needs a design, not a patch.

## 1. Scope of "HTML document"

Static `.html` files as **read documents**: uploaded or synced into the vault,
rendered inline in the portal reader, indexed for search, readable by the agent.

**v1 recommendation: no HTML authoring/editing in the portal** — `.html` is
upload/ingest-only. Markdown remains the canonical *authored* format (the
philosophy doc's "Markdown is the durable layer"); HTML is imported *content*.
This reconciliation is the answer to the "Markdown first" tension: Markdown is
the canonical **authored** format; HTML docs are first-class **content** that
the portal renders and the agent reads, but the portal never *writes* HTML as
its authoring output. (Surfaced as the honest open question it is — §9 Q1.)

## 2. Sanitization contract (the heart of the spec)

Pipeline (implemented in the spike):

```
rehype-parse (document) → extractBody → rehype-sanitize (default schema) → rehype-stringify → SanitizedHtml
```

- **Document parse, then body extraction.** Parse as a full document; lift
  `<body>` children to the root, dropping `<html>`/`<head>`/`<title>`/doctype.
  A fragment with no `<body>` passes through untouched. (Decided over fragment
  parse — full documents are the common upload shape.)
- **`SanitizedHtml` branding stays the ONLY path** to
  `dangerouslySetInnerHTML`. HTML docs earn the brand via this pipeline; they
  never bypass it. The brand now has exactly two producers: `renderMarkdown`
  and `renderHtmlDocument` — a third would be a review-flagged defect.

**Allowlist** — start from `rehype-sanitize`'s default schema (`hast-util-sanitize`
`defaultSchema`), which is already the Markdown trust boundary. Explicitly
verified-stripped (tested in `html.test.ts`):

| Construct | Disposition |
|---|---|
| `<script>` | **stripped** (permanently out) |
| `<iframe>`, `<object>`, `<embed>` | **stripped** (permanently out) |
| `on*` event-handler attributes | **stripped** |
| `javascript:` / `data:` (non-image) URLs | **stripped** (default schema protocol filter) |
| `<style>` tags | **stripped** |
| inline `style="…"` attributes | **stripped** (default schema drops `style`) — recommend keep stripped; document the visual-fidelity cost |
| `<form>`, form controls | **stripped** |
| headings, `<p>`, lists, `<table>`, `<a href>` (safe protocols), `<img src>` | **kept** |

- **Relative links/images inside the HTML**: recommend rewriting relative
  `href`s that point at vault keys → portal doc routes (`/[...id]`) at render
  time; external `<img>` either strip or proxy. *Open question §9 Q2* —
  recommend strip-external-images for v1 (no outbound requests from a doc the
  user is reading), revisit a proxy later.

**Never deferred, always out**: JS execution, iframes, external resource
loading. These are sanitized away permanently, not "v2".

## 3. Metadata

gray-matter's `---` YAML doesn't apply to HTML. Options: (a) `<title>`/`<meta>`
extraction; (b) sidecar `.meta.yml`; (c) key-derived only.

**Recommend (a) title + key-derived rest for v1.** `htmlTitle(raw)` (spike)
extracts `<title>` then first `<h1>`. Map to the same `DocSummary` fields:

| Field | HTML source |
|---|---|
| `title` | `htmlTitle()` → key-derived fallback |
| `updated` | S3 `LastModified` (no frontmatter to carry it) |
| `source_type` | `uploaded` |
| `author` | `unknown` (key-derived if a convention emerges) |
| `tags` | `[]` |
| `snippet` | `htmlText(raw, N)` |

## 4. Listing layer (preserving the `.css` invariant)

`listObjects` keeps only `.md` today; `listCssObjects` carries the load-bearing
invariant: *"no portal write route can ever create a `.css` key — every write
forces `.md`,"* which keeps the theme source and user-writable content from
overlapping (`docs/theming.md`).

**Recommendation**: widen listing to a **parameterized extension set**
`['.md', '.html']` at the single choke point (`s3.ts` `listObjects` + the mock,
in lockstep — cite plan 003's mock-contract lesson). `isDocumentKey` gains a
`.html` branch under the *same* root/exclusion rules (and folds into plan 021's
mode-aware recognition — see §8). The theme invariant then **narrows but stays
airtight**: *"no write route creates a `.css` key."* `.css` under
`THEME_VAULT_PREFIX` remains operator-only; HTML writes never touch `.css`.

## 5. Snippets / search

HTML → text via the parse tree (`htmlText`, spike), **not regex** — tag-strip by
walking text nodes, skipping `<script>`/`<style>` bodies. `search.ts`'s
`buildIndex`, `index-gen`'s `buildLine`, and the docs route's summary each get
an HTML-aware branch that calls `htmlText` instead of the Markdown snippet
extractor, dispatched on extension.

## 6. Agent

- `read_document` on an HTML doc returns **extracted text** (`htmlText` with a
  high char cap) — Nova doesn't need tags, and tags waste tokens.
- `propose_page` stays **Markdown-only** — user-confirmed writes stay in the
  canonical format (philosophy: Markdown is the durable layer). Both stated
  explicitly so a future contributor doesn't "helpfully" add HTML proposals.

## 7. Upload path

- Extension gate widens to `.md` + `.html`; size gate unchanged (plan 005).
- `putObject` hardcodes `text/markdown` content-type today — **touch-list
  item**: parameterize to `text/html; charset=utf-8` for `.html` writes.
- **Raw/curate destination**: v1 = **authored-destination only** for HTML (no
  HTML through the curate pipeline — that pipeline generates Markdown pages).

## 8. Phase 8 relationship

ROADMAP Phase 8 ("HTML Publishing") *generates* HTML **from** Markdown — an
output artifact, distinct from this plan (HTML as a first-class **source**).
**They must share this spec's sanitizer/allowlist module** — published HTML runs
through the same schema. A second sanitizer anywhere is a defect. Interaction
with plan 021: 021 widens which **keys** are documents; this widens which
**extensions** are — land 021's mode logic first so both thread through **one**
recognition function.

## 9. Touch list

From the Step-1 recon (`grep endsWith('.md')`; 7 files):

| Module | `.md` assumption | Change | Effort |
|---|---|---|---|
| `web/lib/s3.ts` + `s3-mock.ts` | `listObjects` `.md`-only | parameterized extension set (one choke point, mock in lockstep) | **M** |
| `web/lib/vault-paths.ts` | `isDocumentKey` requires `.md` | `.html` branch (folds into 021 recognition) | S |
| `web/lib/markdown.ts` | Markdown render only | render dispatch by extension → `html.ts` for `.html` | S (spike done) |
| `web/lib/search.ts` | `matter()` + Markdown snippet | HTML branch → `htmlText` | S |
| `web/lib/index-gen.ts` | `buildLine` Markdown snippet | HTML branch | S |
| `web/app/api/docs/[...id]/route.ts` | Markdown reader | dispatch render; `SanitizedHtml` unchanged | S |
| `web/app/api/upload/route.ts` | rejects non-`.md`; `text/markdown` PUT | widen gate + content-type | S |
| `web/app/api/chat/route.ts` (agent read) | Markdown | `htmlText` for `.html` | S |
| e2e fixtures | Markdown only | add an HTML fixture + a hostile-HTML fixture | S |

## 10. Open questions

1. **Browse-only vs eventual HTML editing.** Recommend browse-only v1
   (reconciles "Markdown first"). *Confirm?*
2. **External images — strip vs proxy.** Recommend strip for v1 (no outbound
   requests from a doc being read); proxy is a later, separate decision.
3. **Inline `style=` attributes — keep stripped vs allow a safe subset.**
   Recommend keep stripped (default schema); some uploaded HTML will look plain.
   Accept the fidelity cost or scope a curated style-attr allowlist later?
4. **Relative-link rewriting** to portal routes — v1 or v2? Recommend v1 for
   in-vault links (broken links otherwise), external left as-is.
5. **`data:` image URIs** — default schema strips them; some exported HTML
   embeds images as `data:`. Recommend accept the strip for v1 (security > 
   fidelity); revisit with a size-bounded `data:image/*` allow if users hit it.

## Test matrix (for the implementation plan)

Sanitizer table (landed — `html.test.ts`); upload → browse → search → agent-read
of an HTML doc end-to-end; a **hostile-HTML e2e fixture** (script/onerror/
iframe) that must render inert; `.css` invariant regression (no write route
creates `.css`); mixed `.md`+`.html` listing; `htmlTitle`/`htmlText` on
malformed HTML.
