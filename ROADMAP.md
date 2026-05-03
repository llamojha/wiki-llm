# Vaultmark — Roadmap

Engineering plan derived from [`prd_vaultmark_markdown_llm_wiki.md`](prd_vaultmark_markdown_llm_wiki.md). Source of truth for sequencing and scope.

## Decisions log

Locked decisions on PRD §16 open questions (and related):

| Question | Decision |
|---|---|
| Storage backend | **AWS S3 only**. No MinIO/R2 abstraction. Standard S3 SDK. |
| Editing model | **In-browser only** for MVP 1. No local folder sync. |
| `index.md` mandatory? | **Yes**, machine-maintained. It is the ask-wiki agent's catalog. |
| Generated vs user-authored | **Single `generated/` prefix** for AI output. User-authored content (typed or uploaded) lives in `wiki/`; provenance tracked via `source_type` metadata (`authored | uploaded | generated`). |
| Auth | **Single user** for OSS. Auth (Keycloak/OIDC) only ships with the SaaS phase. |
| Ask-wiki agent provider | **Amazon Bedrock — Nova 2 Lite** (`amazon.nova-2-lite-v1:0`). 1M token context, multimodal-capable. Cross-region inference profile when needed (`us.amazon.nova-2-lite-v1:0`). |
| Ask-wiki agent scope | **Tool-using agent** (search / read / propose-page) with citations, refusal, and scope. **Out of scope:** vector search, autonomous writes, multi-agent. |

## S3 layout

```
s3://<bucket>/<vault-prefix>/
  raw/         # source documents, immutable inputs
  wiki/        # user-authored pages (typed in editor or uploaded)
  generated/   # AI-generated pages from the ingest pipeline
  assets/      # images and other binary assets
  index.md     # machine-maintained catalog (mandatory)
  log.md       # append-only history (mandatory)
```

`source_type` on the metadata row distinguishes `authored | uploaded | generated`.

## Milestone Mapping

| PRD Milestone | Phases | What the user gets |
|---|---|---|
| Demo | Phase 0 + 1 + 2 | Browse and search a real S3 vault in the portal |
| MVP 1 | Phase 3 | Feed raw docs through Bedrock ingest, get structured pages |
| MVP 2 | Phase 4 + 5 | Full personal wiki CRUD + ask-wiki agent |
| SaaS | Phase 6 | Multi-tenant hosted product |

## Phases

### Phase 0 — Skeleton ✓

Just enough scaffolding to start Phase 1.

- [x] pnpm workspace at repo root
- [x] `web/` — Next.js 16.2 + React 19 + TypeScript strict
- [x] `next/font` configured for IBM Plex Sans, IBM Plex Serif, JetBrains Mono (replace prototype's Google Fonts CDN)
- [x] Drop `portal/styles.css` into `web/app/globals.css` (verbatim, for parity)
- [x] Confirm dev server renders an empty shell with the right fonts and theme tokens
- [x] `README.md` rewritten for Vaultmark (this PR)
- [x] `ROADMAP.md` (this PR)

Deferred from this phase: `api/`, `infra/`, CI. They land when Phase 2 needs them.

### Phase 1 — Visual port (Demo, mock-backed)

Pixel-perfect Next.js port of `portal/`. Mock data only.

- [ ] Port mock data: `portal/data.jsx` + `portal/doc-bodies.jsx` → `web/lib/mock/`
- [ ] Port icons: `portal/data.jsx::ICONS` → `web/lib/icons.tsx`
- [ ] Port `Sidebar` (shared/personal scope, tree)
- [ ] Port `TopBar` (search trigger, theme switch, chat toggle)
- [ ] Port `HomeView` (welcome, ask-the-wiki hero, recent docs, stats)
- [ ] Port `DocReader` (toolbar, breadcrumbs, TOC, rendered Markdown)
- [ ] Port `SearchPalette`
- [ ] Port `Editor`
- [ ] Port `ChatPanel` (UI only; not wired to a model yet)
- [ ] Port `TweaksPanel` (dev-only; gate behind env flag)
- [ ] Side-by-side parity sign-off vs the prototype, then delete `portal/`

**Gate:** parity confirmed visually before moving on.

#### Phase 1 implementation notes (drifts from the initial plan)

Decisions made during the port that diverge from the original step plan. Documented so reviewers don't have to reconstruct them from git history.

**Routing — state-driven SPA, not URL routes (Step 3).** The initial plan specified `app/page.tsx → HomeView` and `app/[...slug]/page.tsx → DocReader`. Reverted: the prototype is a pure SPA with React state driving content swap, and matching that is the literal interpretation of "pixel-perfect." `AppShell` holds `activeId` state; clicking the sidebar updates state, no URL change. **Cost:** no deep-linking or share-able URLs yet. **When to revisit:** Phase 2 — once the API ships, deep-linking via `/docs/[id]` becomes valuable for permission-checked sharing.

**Doc-bodies port format — mirror prototype source, not prettier (Step 1).** First pass used multi-line JSX with `{' '}` spacers (modern formatting). Rewrote to mirror the prototype's single-line `<p>` blocks so source is byte-comparable. Renders identically either way; the rewrite is to make the parity script trivial.

**Discriminated union for `Doc` (Step 3, originally planned for Step 1).** Added `Cite`, `AuthoredDoc`, `GeneratedDoc`, `Doc = AuthoredDoc | GeneratedDoc` in `web/lib/mock/data.ts`. The prototype is loose JS where `doc.generated` is just a property check; TS strict needs the discriminator for narrowing.

**`'use client'` placement — boundary-only (Step 2).** Plan said "establish 'use client' boundaries — most components will be 'use client'." Adopted minimum: only `app-shell.tsx` carries the directive, plus `home-view.tsx` and `toc.tsx` where hooks are used at component scope. Children of a client tree become client-bundled implicitly via the import graph.

**Theme bootstrap script (Step 2, not in original plan).** Added an inline `<script>` in `<head>` that synchronously reads `localStorage['vaultmark-theme']` and sets `data-theme` before React hydrates. Eliminates the dark/light flash on reload. Standard practice; flagged because it wasn't pre-planned.

**Date hydration handling (Step 3, not in original plan).** `HomeView` shows `new Date().toDateString()`. SSR'd on the server, hydrated on the client — those values can differ across the request boundary. Wrapped in a `useState('') + useEffect(() => setToday(...))` pattern so the date appears post-mount; renders empty during SSR. Avoids hydration warnings without `suppressHydrationWarning`.

**Parity verification — automated source diff, not visual sign-off (all of Phase 1).** Plan said "Side-by-side parity sign-off vs the prototype" implying eyeball comparison in browser. Built four automated parity scripts instead (structural counts, byte-level icons, byte-level data, JSX surface). Catches drift the eye misses; the visual check at `/dev/parity` is now a quick sanity confirm rather than the primary gate.

**TweaksPanel — deferred (Step 4).** Dev-only floating preferences panel (425 lines: theme, density, accent hue, reader width, chat toggle) was on the Step 4 list. Skipped: the tokens it controls (`density`, `readerWidth`, accent hue) are not surfaced in the visible product anywhere outside the panel itself; `theme` and `chat` are already wired through `TopBar` and `ChatPanel`. Revisit if/when those tokens become user-facing settings, or before MVP 1 ships if the dev panel is wanted for prototyping.

### Phase 2 — Real Read Path (Demo)

Backend joins. Real S3 read, real search. Editor and Chat stay mock-backed.

- [ ] `api/` — FastAPI 0.136 + Python 3.13 + uv
- [ ] `infra/docker-compose.yml` — Postgres 17 + api + web
- [ ] DB schema: `vaults`, `documents`, `search_records` (per PRD §10)
- [ ] S3 read client (boto3); list + get
- [ ] Markdown render server-side with sanitization (`remark` + `rehype-sanitize`)
- [ ] Postgres FTS index, populated from S3 listing
- [ ] Navigation tree from `index.md` (canonical), folder hierarchy as fallback
- [ ] FastAPI endpoints: `GET /vaults`, `GET /vaults/{id}/tree`, `GET /docs/{id}`, `GET /search`
- [ ] Wire `web/` read + search paths to the API; Editor and Chat remain mock-backed
- [ ] CI: lint + typecheck + build for both packages

**Acceptance:** see `specs/phase-2-real-read-path.md`

### Phase 3 — Ingest Pipeline (MVP 1)

Revive `legacy/wiki.py` as a containerized worker. Builds the S3 write infrastructure.

- [ ] Port `wiki.py` core out of `legacy/` into a `worker/` (or `api/workers/`) container
- [ ] S3 write layer: PutObject for `generated/` prefix; `source_type = generated`
- [ ] Hierarchical `index.md` (root + per-folder), regenerated once per ingest run
- [ ] AI context files on vault init: `AGENTS.md`, `WIKI_RULES.md`, `SOURCES.md`, `TASKS.md`
- [ ] `log.md` as app logger (all writes, ingest runs, index rebuilds); auto-rotate at size threshold
- [ ] Bedrock model pinned to `amazon.nova-2-lite-v1:0`; configurable per env
- [ ] CLI entrypoint: `vaultmark ingest <s3-key>` and `vaultmark lint`
- [ ] Dockerfile + Compose service entry

**Acceptance:** see `specs/phase-3-ingest-pipeline.md`

### Phase 4 — Personal Wiki CRUD (MVP 2)

User-facing write path on top of Phase 3's infrastructure.

- [ ] Personal wiki CRUD: create / edit / delete via Editor
- [ ] S3 write with optimistic concurrency (checksum-based) — 409 on conflict
- [ ] Frontmatter as canonical metadata; mismatch triggers reindex
- [ ] Immediate `index.md` regen on every user write/delete
- [ ] `log.md` append on every create/edit/delete
- [ ] Postgres search index refresh on every write
- [ ] Sanitization audit, document allowed tags
- [ ] Markdown rendering: headings, links, images, fenced code, tables, frontmatter, heading anchors
- [ ] No tags — search indexing handles discoverability

**Acceptance:** see `specs/phase-4-personal-wiki-crud.md`

### Phase 5 — Ask-Wiki Agent (MVP 2)

Bedrock Nova 2 Lite agent in the chat panel.

- [ ] FastAPI `/chat` endpoint; streaming (SSE or chunked)
- [ ] Bedrock client (boto3) targeting `amazon.nova-2-lite-v1:0`
- [ ] Agent loop: read `index.md` → tool calls → answer with citations
- [ ] Tools:
  - [ ] `search_vault(query, scope)` — Postgres FTS with scope (all / folder / page)
  - [ ] `read_document(doc_id)` — full Markdown from S3
  - [ ] `propose_page(slug, title, body)` — preview + user-confirmed write only
- [ ] Scoped search (agent-only; UI search stays global)
- [ ] Agent proposes new pages only, on explicit user request
- [ ] Refusal behavior on zero relevant hits
- [ ] Citations with deep links to docs
- [ ] Usage logging; chat persistence deferred

**Acceptance:** see `specs/phase-5-ask-wiki-agent.md`

### Phase 6 — SaaS (deferred)

Only after MVP 2 has been used in anger.

- Multi-tenant S3 layout (`tenants/<tenant>/users/<user>/`)
- Auth: Keycloak / OIDC / SAML
- Search backend swap to OpenSearch or Meilisearch
- RDS Postgres, EKS workers / SQS consumers
- Admin dashboard, billing, audit logs, tenant isolation

**Acceptance:** see `specs/phase-6-saas.md`

## Out of scope (forever, or until reconsidered)

- Real-time collaborative editing
- Vector search / RAG embedding pipelines
- Autonomous agent writes (every write is user-confirmed)
- Multi-agent orchestration
- PDF / DOCX ingestion
- Public publishing workflow

## Where the legacy fits

`legacy/wiki.py` is earmarked as the seed for Phase 4. Until then, treat `legacy/` as frozen reference. Don't import from it; port out of it.
