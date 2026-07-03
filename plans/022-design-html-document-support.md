# Plan 022: Design first-class HTML document support (render/store .html like .md)

> **Executor instructions**: This is a **design/spike plan** — the deliverable
> is a written spec plus a sanitization spike, NOT a full implementation.
> Follow the steps, honor STOP conditions, and update `plans/README.md` when
> done.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/markdown.ts web/lib/s3.ts web/lib/vault-paths.ts web/app/api/upload/route.ts docs/theming.md`
> On material drift, re-derive "Current state" before writing the spec.

## Status

- **Priority**: P2
- **Effort**: M (design + spike)
- **Risk**: LOW as a spike; the FEATURE it designs is security-sensitive
- **Depends on**: none (must cite plans/002 and /005 — same boundaries)
- **Category**: direction / design
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The maintainer wants vaults to hold HTML documents with the same standing as
Markdown — uploaded, browsed, searched, and cited by the agent. Today `.html`
is invisible end to end: the S3 listing layer is hard-filtered to `.md`, the
upload route rejects anything but `.md`, and the render pipeline assumes
Markdown input. HTML is ALSO the repo's most guarded security surface (the
whole sanitize-everything discipline exists because rendered HTML is where
XSS lives), and one existing guarantee depends on **no write path ever
creating a non-`.md` key** — so this needs a design, not a patch.

## Current state (what excludes HTML today)

- `web/lib/s3.ts:87-116` — `listObjects` keeps only `rel.endsWith('.md')`.
  Comment on `listCssObjects` (158-167) states the load-bearing invariant:
  "**no portal write route can ever create a `.css` key — every write forces
  `.md`.** That keeps the theme source and the user-writable content tree
  from overlapping" (see `docs/theming.md` security note). Allowing `.html`
  writes must not weaken this: `.css` under `THEME_VAULT_PREFIX` remains
  operator-only.
- `web/lib/vault-paths.ts:79-93` — `isDocumentKey` requires `.endsWith('.md')`.
- `web/app/api/upload/route.ts` — `if (!file.name.endsWith('.md')) return 400
  ('only .md files are accepted')`.
- `web/lib/markdown.ts:16-33` — unified pipeline
  `remark-parse → remark-frontmatter → remark-gfm → remark-rehype →
  rehype-slug → rehype-sanitize (default schema) → rehype-stringify`,
  producing the branded `SanitizedHtml` type — "the only way to produce a
  value accepted by … DocReader's dangerouslySetInnerHTML" (types in
  `web/lib/types.ts`). Key fact: **rehype-sanitize is already in the deps and
  already the trust boundary** — an HTML path reuses it via
  `rehype-parse → rehype-sanitize → rehype-stringify`.
- Frontmatter: gray-matter parses `---` YAML at byte 0 — meaningless in HTML.
  Metadata for HTML docs needs a decision (see Step 2 §3).
- Search (`web/lib/search.ts`), index-gen `buildLine`, doc routes'
  `summarizeDoc`, agent `read_document` all call `matter(raw)` on the body and
  strip *Markdown* syntax for snippets — each needs an HTML-aware branch.
- The steering docs mandate: "Sanitize all rendered Markdown … Never
  `dangerouslySetInnerHTML` raw user content" and "documented allowed tags" —
  the design must produce that allowlist for HTML.
- Precedent for the plumbing: ROADMAP Phase 8 ("HTML Publishing") is about
  *generating* HTML FROM Markdown — related but distinct (publishing = output
  artifact; this plan = HTML as a first-class SOURCE document). The spec must
  state the relationship so Phase 8 doesn't fork the sanitizer.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck (spike) | `pnpm typecheck` | exit 0 |
| Unit (spike) | `pnpm --filter @vaultmark/web test` | sanitizer table passes |
| E2E | `pnpm build && pnpm test:e2e` | all pass (defaults unchanged) |

## Scope

**In scope**:
- `specs/html-documents.md` (create — the deliverable)
- Spike: `web/lib/html.ts` + `web/lib/__tests__/html.test.ts` (a
  `renderHtmlDocument()` behind no route — pure library + tests is safe to
  land; wiring it to routes is NOT in this plan)

**Out of scope**:
- Route/UI wiring, upload acceptance, search/index integration — the
  follow-up implementation plan.
- Editor support for HTML (browse-only is the recommended v1 — argue it in
  the spec).
- JS execution, iframes, external resource loading in rendered HTML — the
  spec should treat these as permanently out (sanitized away), not deferred.

## Git workflow

- Branch: `advisor/022-html-docs-design`
- Deliverable commit: spec + spike lib/tests only.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Inventory the `.md` assumption

`grep -rn "\.md\b\|endsWith('.md')" web/lib web/app --include='*.ts*' | grep -v __tests__ | grep -v "\.md files"` —
build the spec's touch-list table (module → assumption → change needed →
effort S/M/L). Expect at minimum: s3 listing, vault-paths classifiers, upload
validation, markdown/render dispatch, search snippet/индех buildLine,
summarizeDoc, agent read_document + propose_page (Markdown-only by design?),
editor routes, e2e fixtures.

### Step 2: Write `specs/html-documents.md`

Required sections:

1. **Scope of "HTML document".** Static `.html` files as READ documents:
   uploaded or synced into the vault, rendered inline in the portal reader,
   indexed for search, readable by the agent. v1 recommendation: no HTML
   authoring/editing in the portal; `.html` is upload/ingest-only.
2. **Sanitization contract (the heart of the spec).** Pipeline:
   `rehype-parse (fragment vs document mode — decide; recommend document
   parse then extract body) → rehype-sanitize with an explicit schema →
   rehype-stringify → SanitizedHtml`. Deliver the tag/attribute allowlist as
   a table (start from rehype-sanitize defaults; explicitly banned: script,
   iframe, object/embed, event handlers, javascript: URLs, style tags —
   decide inline style attributes: recommend strip, document the cost).
   State that `SanitizedHtml` branding stays the ONLY path to
   `dangerouslySetInnerHTML` — HTML docs reuse the brand, never bypass it.
   Include how relative links/images inside the HTML resolve (recommend:
   rewrite relative hrefs to portal doc routes when they point at vault keys;
   strip or proxy external images? — open question with recommendation).
3. **Metadata.** gray-matter doesn't apply. Options: (a) HTML `<meta>`/
   `<title>` extraction; (b) sidecar `.meta.yml`; (c) key-derived only.
   Recommend (a) title + key-derived rest for v1; map to the same
   `DocSummary` fields (`title, updated (S3 LastModified), source_type:
   'uploaded', tags: []`).
4. **Listing layer.** How `.html` enters listings WITHOUT breaking the
   `.css`-exclusion invariant: recommend widening `listObjects` to a
   parameterized extension set `['.md', '.html']` (single choke point in
   s3.ts + mock; cite plans/003's mock-contract lesson) while `isDocumentKey`
   gains the `.html` branch under the same root/exclusion rules. The
   theme-loader invariant then becomes: "**no write route creates `.css`**"
   — narrower but still airtight; state it.
5. **Snippets/search.** HTML → text extraction for snippets (strip tags via
   the sanitizer pipeline's text content, not regex).
6. **Agent.** `read_document` on HTML returns extracted text (Nova doesn't
   need tags; token cost). `propose_page` stays Markdown-only (user-confirmed
   writes stay in the canonical format — philosophy doc: Markdown is the
   durable layer). State both.
7. **Upload path.** Extension + size gates (cite plans/005), `text/html`
   content-type on the S3 PUT (today's putObject hardcodes
   `text/markdown` — touch-list item), and the raw-destination question
   (HTML through the curate pipeline? v1: authored-destination only).
8. **Phase 8 relationship.** Published HTML output must go through the SAME
   sanitizer/allowlist; the spec's schema module is shared.
9. **Touch list** (Step 1) + **open questions** (≤5, each with a
   recommendation).

### Step 3: Spike the sanitizer

Implement `web/lib/html.ts`:

```ts
export async function renderHtmlDocument(raw: string): Promise<SanitizedHtml>
export function htmlTitle(raw: string): string | null   // <title>/<h1> extraction
export function htmlText(raw: string, maxChars?: number): string  // snippet source
```

using `rehype-parse`/`rehype-sanitize`/`rehype-stringify` (add `rehype-parse`
as a devDep is wrong — it becomes a real dep; the spike may add it to
`web/package.json` dependencies since the lib lands). Test table
(`html.test.ts`, mirroring plan 004's markdown suite): script/iframe/onerror/
javascript:-href/style-tag/form stripped; headings/tables/links/images kept;
full-document input (doctype+head) → body content only; `htmlTitle`
extraction precedence; `htmlText` tag-stripping.

**Verify**: unit tests pass; `pnpm typecheck` exit 0; full e2e green (nothing
routes to the new lib yet).

## Test plan

Spike tests as above; the spec must include the implementation plan's full
test matrix (upload → browse → search → agent-read of an HTML doc; a
hostile-HTML e2e fixture).

## Done criteria

- [ ] `specs/html-documents.md` complete per Step 2 (incl. the explicit tag allowlist table and the preserved `.css` invariant statement)
- [ ] `web/lib/html.ts` + passing sanitizer test table landed, unused by routes
- [ ] Touch list covers every Step 1 grep hit
- [ ] Full e2e green (default behavior unchanged)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `rehype-sanitize`'s default schema can't express a needed rule (e.g.
  URL-protocol filtering on href) without a custom schema too complex to
  spike — document the limitation, recommend the library alternative, stop.
- PRD/philosophy docs turn out to forbid non-Markdown sources outright
  (re-read the "Markdown first" section — it says Markdown is the *canonical
  source of truth*; the spec must reconcile: HTML docs are content, Markdown
  remains the canonical *authored* format — if that reconciliation feels
  strained, surface it as the open question it is).

## Maintenance notes

- The sanitizer schema module becomes THE shared trust boundary for this and
  Phase 8 — flag any future second sanitizer in review as a defect.
- Interaction: plans/021 (folder-first) widens which KEYS are documents; this
  plan widens which EXTENSIONS are — implementation should land 021's mode
  logic first so the extension set threads through one recognition function.
