# Vaultmark — Roadmap

Engineering plan derived from [`prd_vaultmark_markdown_llm_wiki.md`](prd_vaultmark_markdown_llm_wiki.md). Source of truth for sequencing and scope.

## Decisions log

Locked decisions on PRD §16 open questions (and related):

| Question | Decision |
|---|---|
| Storage backend | **AWS S3 only**. No MinIO/R2 abstraction. Standard S3 SDK. |
| Editing model | **In-browser only** for MVP 1. No local folder sync. |
| `index.md` mandatory? | **Yes**, machine-maintained. It is the ask-wiki agent's catalog. |
| Generated vs user-authored | **Shared plus user-scoped provenance-rooted S3 layout**. Shared content uses root-level `raw/`, `generated/<space>/`, `authored/<space>/`, and `_system/`. Each user also owns `users/<user-id>/raw/`, `users/<user-id>/generated/<space>/`, `users/<user-id>/authored/<space>/`, and `users/<user-id>/_system/`. The UI hides these roots and shows logical spaces. |
| Auth | **Single user** for OSS. Auth (Keycloak/OIDC) only ships with the SaaS phase. |
| Ask-wiki agent provider | **Amazon Bedrock — Nova 2 Lite** (`amazon.nova-2-lite-v1:0`). 1M token context, multimodal-capable. Cross-region inference profile when needed (`us.amazon.nova-2-lite-v1:0`). |
| Ask-wiki agent scope | **Tool-using agent** (search / read / propose-page) with citations, refusal, and scope. **Out of scope:** vector search, autonomous writes, multi-agent. |

## S3 layout

```
s3://<bucket>/<vault-prefix>/
  raw/                    # shared source documents, immutable inputs
  generated/<space>/      # shared AI-generated pages grouped by logical space
  authored/<space>/       # shared human-authored pages grouped by logical space
  _system/                # shared machine-maintained catalogs, jobs, manifests
  users/<user-id>/
    raw/                  # user source documents, immutable inputs
    generated/<space>/    # user-scoped AI-generated pages
    authored/<space>/     # user-authored pages; personal pages use authored/personal/
    _system/              # user-scoped catalogs, jobs, manifests
  assets/                 # images and other binary assets
```

`source_type` metadata distinguishes `authored | uploaded | generated | personal`.

## Milestone Mapping

| PRD Milestone | Phases | What the user gets |
|---|---|---|
| Demo | Phase 0 + 1 + 2 | Browse and search a real S3 vault in the portal |
| MVP 1 | Phase 3 | Feed raw docs through Bedrock ingest, get structured pages |
| MVP 2 | Phase 4 + 5 | Full personal wiki CRUD + ask-wiki agent |
| SaaS | Phase 6 | Multi-tenant hosted product |
| Multimodal | Phase 7 | Voice chat, generated images/infographics, document podcasts |

## Architecture note (post-Phase 2 pivot)

As of Phase 2 completion, the backend was migrated from Python/FastAPI to Next.js Route Handlers. The entire app is now a single Next.js project deployable to Vercel (free tier) or Docker. No Python, no Postgres, no separate backend service. In-memory search (Fuse.js) replaces Postgres FTS. The ingest pipeline (Phase 3) is a standalone TypeScript CLI in the same monorepo.

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

### Phase 2 — Real Read Path (Demo) ✓

Backend joins. Real S3 read, real search. Editor and Chat stay mock-backed.

- [x] `api/` — FastAPI 0.136 + Python 3.13 + uv
- [x] `infra/docker-compose.yml` — Postgres 17 + api + web
- [x] DB schema: `vaults`, `documents`, `search_records` (per PRD §10)
- [x] S3 read client (boto3); list + get
- [x] Markdown render server-side with sanitization (`remark` + `rehype-sanitize`)
- [x] Postgres FTS index, populated from S3 listing
- [x] In-memory fuzzy search (rapidfuzz) as primary/fallback — no Postgres required for demo
- [x] Navigation tree from `index.md` (canonical), folder hierarchy as fallback
- [x] FastAPI endpoints: `GET /vaults`, `GET /vaults/{id}/tree`, `GET /docs/{id}`, `GET /search`
- [x] Wire `web/` read + search paths to the API; Editor and Chat remain mock-backed
- [x] CI: lint + typecheck + build for both packages

**Acceptance:** see `specs/phase-2-real-read-path.md`

### Phase 3 — Ingest Pipeline (MVP 1) ✓

TypeScript CLI that transforms raw docs into structured wiki pages via Bedrock.

- [x] `ingest/` package in the pnpm workspace (TypeScript, shared `@aws-sdk` deps)
- [x] CLI entrypoint: `pnpm ingest <s3-key-or-glob>` and `pnpm ingest --lint`
- [x] S3 write layer: PutObject for `generated/` prefix; `source_type = generated`
- [x] Bedrock invoke via `@aws-sdk/client-bedrock-runtime`; model pinned to `amazon.nova-2-lite-v1:0`
- [x] `index.md` regeneration (flat list of all navigable docs) after each ingest run
- [ ] `log.md` append on every ingest run; auto-rotate at size threshold — *deferred (see notes)*
- [x] AI context files on vault init: `AGENTS.md`, `WIKI_RULES.md`, `SOURCES.md`, `TASKS.md` (via `ingest init`)
- [x] End-to-end: place file in `raw/`, run ingest, verify pages in `generated/` are searchable in portal

**Acceptance:** see `specs/phase-3-ingest-pipeline.md`

#### Phase 3 implementation notes (drifts from the initial plan)

**Architecture pivot from CLI-first to Lambda-first.** The original plan was a TypeScript CLI (`pnpm ingest <key>`). What shipped is a Vercel-friendly split: `ingest/` package retains the CLI for vault init + ad-hoc runs, but the user-facing batch path is a portal **Process pending** button (`/api/curate/start`) that fan-outs to an AWS Lambda (`infra/lambda/curate/`). This avoids running long Bedrock loops inside Next.js Route Handlers (Vercel free-tier 60s ceiling) while keeping the dev experience interactive.

**Post-curate finalize step.** Index regeneration is *not* done inside the Lambda — instead `/api/curate/finalize` is called from the UI after the job's status flips to `done`. The route runs `regenerateSpaceIndex(job.space) + regenerateMasterIndex() + invalidateSearchIndex()` using `web/lib/index-gen.ts`. Idempotent via a `finalized` flag on the job state.

**`log.md` append — deferred.** The legacy `web/lib/ingest/run.ts` had `appendLog`, but the Lambda path doesn't. Manifest-based tracking (`_system/processed.json`) covers the "what's been ingested" question; a human-readable audit log can land later without blocking the phase.

**Placement hints loaded once per Lambda invocation.** Original ingest re-read 50 existing pages per file. Refactored to a single `loadPlacementHints` call in `index.ts` handler entry. See postmortem session in `.memory/sessions/2026-05-17-191704.md` for full reasoning.

**Bounded concurrency.** Lambda runs files with `CURATE_CONCURRENCY=3` (env-tunable). All job-JSON writes serialized through an in-process async queue to avoid clobber races.

**Per-stage UI progress.** Lambda writes `stage` ('reading' / 'extracting' / 'writing' / 'manifest') to each `JobFile` so the upload modal can show what's happening between Bedrock round-trips. Chain handoffs (when Lambda re-invokes itself near its 5min timeout) surface via `phase: 'chaining'` so the UI doesn't appear frozen during cold-start.

### Phase 4 — Personal Wiki CRUD (MVP 2)

User-facing write path via Next.js Route Handlers.

- [ ] Route Handlers: `POST /api/docs`, `PUT /api/docs/:id`, `DELETE /api/docs/:id`
- [ ] S3 PutObject with checksum-based optimistic concurrency — 409 on conflict
- [ ] Frontmatter as canonical metadata; `source_type = authored`
- [ ] Immediate `index.md` regen on every user write/delete
- [ ] `log.md` append on every create/edit/delete
- [ ] In-memory search index invalidation on write (rebuild on next search)
- [ ] Wire Editor component to real write endpoints (replace mock)
- [ ] Sanitization audit, document allowed tags
- [ ] No tags — search indexing handles discoverability
- [ ] Per-page URLs: `/[...id]` catch-all route mirroring S3 keys for deep-linking and bookmarking
- [ ] Starred documents: `starred` frontmatter field, star/unstar UI, filtered view
- [ ] Mock audit: verify all `web/lib/mock/` usage is replaced by real data paths; remove mock imports from production code

**Acceptance:** see `specs/phase-4-personal-wiki-crud.md`

### Phase 5 — Ask-Wiki Agent (MVP 2)

Bedrock Nova 2 Lite agent in the chat panel, served from Next.js.

- [ ] Route Handler: `POST /api/chat` with streaming (ReadableStream)
- [ ] Bedrock converse API via `@aws-sdk/client-bedrock-runtime`
- [ ] Agent loop: read `index.md` → tool calls → answer with citations
- [ ] Tools (direct function calls to existing lib modules):
  - [ ] `search_vault(query, scope)` — Fuse.js search with scope (all / folder / page)
  - [ ] `read_document(doc_id)` — S3 GetObject via `lib/s3.ts`
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
- Personal space access control: `personal/<user-id>/` routing, per-user index isolation, private space visibility enforcement
- Multi-tenant index isolation: per-space indexes scoped to tenant, master index excludes personal spaces of other users
- S3 Event Notifications → Lambda/SQS for event-driven ingest (replace inline trigger from Phase 3)
- Event-driven ingest: S3 PutObject event on `*/raw/` → triggers ingest automatically (Lambda or background worker). Eliminates need for manual CLI runs or portal trigger buttons. Includes retry logic, dead-letter queue, and status reporting back to the portal.
- Vault structure schema (`structure.json`) improvements: UI for managing spaces (create/rename/reorder/delete), drag-and-drop file moves between spaces, per-space permissions, schema versioning and migration, validation on upload/write to enforce declared structure

**Acceptance:** see `specs/phase-6-saas.md`

### Phase 7 — Multimodal & Audio (deferred)

Only after MVP 2 is stable. Exploratory — scope will be refined when Phase 5 ships.

- [ ] STT input for chat: browser Web Speech API or Amazon Transcribe; voice → text before hitting `/api/chat`
- [ ] TTS output for chat: Amazon Polly neural voices; stream audio response alongside text
- [ ] Image/infographic generation in ingest pipeline: Bedrock Titan Image Generator; output to `assets/`, embed in generated Markdown
- [ ] Document-to-podcast: long-form TTS over document content (single or multi-voice); audio stored in `assets/`; playable from doc toolbar
- [ ] Podcast script generation: LLM rewrites document into conversational script before TTS pass

**Dependencies:** Phase 5 (chat agent) must be complete for STT/TTS. Phase 3 (ingest) must be complete for image generation. Podcast builds on both.

**AWS services:** Amazon Polly (TTS), Amazon Transcribe (STT), Bedrock Titan Image Generator (images).

**Acceptance:** TBD — spec written when this phase is activated.

## Out of scope (forever, or until reconsidered)

- Real-time collaborative editing
- Vector search / RAG embedding pipelines
- Autonomous agent writes (every write is user-confirmed)
- Multi-agent orchestration
- PDF / DOCX ingestion
- Public publishing workflow

## Mock UI features ahead of current phases

The `portal/` prototype (now ported to `web/`) includes UI for features that don't ship until later phases. These are intentionally mock-only until their phase lands:

| Mock feature | Ships in | Notes |
|---|---|---|
| Shared/Personal scope toggle | Phase 6 (SaaS) | Multi-tenant concept; single-user MVP has no scope distinction |
| Scope-aware sidebar filtering | Phase 6 (SaaS) | Requires tenant + user isolation |
| Star button (doc toolbar) | Phase 4 | Stored as `starred: true` in frontmatter |
| Starred docs filter | Phase 4 | Home view + sidebar filtered list |
| Per-page URLs (deep-linking) | Phase 4 | Currently state-driven SPA; Phase 4 adds `/[...id]` catch-all mirroring S3 keys |

Until their phase ships, these features render in the UI but are non-functional or backed by mock data.

## Where the legacy fits

`legacy/wiki.py` is the reference implementation for the ingest pipeline (Phase 3). The logic will be ported to TypeScript in the `ingest/` package. Until then, treat `legacy/` as frozen reference. Don't import from it; port out of it.

`api/` (Python/FastAPI) is archived — replaced by Next.js Route Handlers in `web/app/api/`. Kept as reference for the SaaS phase (Phase 6) if a standalone backend is ever needed again.
