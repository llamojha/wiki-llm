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
| Publishing | Phase 8 | Static HTML pages and visual artifacts generated from canonical Markdown |

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

### Phase 4 — Personal Wiki CRUD (MVP 2) ✓

User-facing write path via Next.js Route Handlers.

- [x] Route Handlers: `POST /api/docs`, `PUT /api/docs/:id`, `DELETE /api/docs/:id`
- [x] S3 PutObject with checksum-based optimistic concurrency — 409 on conflict
- [x] Frontmatter as canonical metadata; `source_type = personal` (see notes — vocabulary divergence)
- [x] Immediate `index.md` regen on every user write/delete
- [x] `log.md` append on every create/edit/delete
- [x] In-memory search index invalidation on write (rebuild on next search)
- [x] Wire Editor component to real write endpoints (replace mock)
- [x] Sanitization audit, document allowed tags (see `web/lib/SANITIZATION.md`)
- [x] No tags — search indexing handles discoverability
- [x] Per-page URLs: `/[...id]` catch-all route mirroring S3 keys for deep-linking and bookmarking
- [x] Starred documents: `starred` frontmatter field, star/unstar UI, filtered view
- [x] Mock audit: verify all `web/lib/mock/` usage is replaced by real data paths; remove mock imports from production code

**Acceptance:** see `specs/phase-4-personal-wiki-crud.md`

#### Phase 4 implementation notes (drifts from the initial plan)

**`source_type = personal` for personal-wiki writes, not `authored`.** The original checklist line said `source_type = authored`, but the implementation writes `'personal'` for documents created via the personal wiki path (`POST /api/docs` → `lib/vault-paths.ts::personalPrefix()` → `users/<id>/authored/personal/`). This matches the decisions log's full vocabulary (`authored | uploaded | generated | personal`) and the helper in `vault-paths.ts::sourceTypeFromKey` which returns `'personal'` for that prefix. `authored` remains reserved for shared, non-AI human-authored pages (Phase 6 territory in the multi-tenant scope).

**Optimistic concurrency uses S3 ETags directly.** No content hashing — the `getObjectWithETag` helper returns the ETag from S3's `HeadObject`/`GetObject`, the editor round-trips it as `etag` in the PUT body, and `putObject(key, body, ifMatch)` calls `PutObject` with `IfMatch` set. S3 returns `PreconditionFailed` which `lib/s3.ts` re-throws as `ConcurrencyError`, the route maps to 409.

**Side effects on every write are inline, not queued.** `POST/PUT/DELETE` synchronously run `regenerateIndexesForKey(key)` (or `regenerateMasterIndex` on create) + `appendLog(...)` + `invalidateSearchIndex()` before returning. Trade-off: write latency includes index regen (typically <1s on a small vault); benefit is no eventually-consistent window where a doc is on S3 but not yet in `index.md` or search. Revisit if vault size makes this slow.

**`/dev/parity/page.tsx` still imports from `lib/mock/` — intentional.** The parity-verification page (`web/app/dev/parity/`) is dev-only by route name and exists to diff against `portal/`. It's the only remaining mock importer; no production paths use it.

**Star route lives at `PATCH /api/star/[...id]`, separate from `/api/docs`.** Toggling `starred` is its own narrow operation (frontmatter-only edit, no body). Keeps the docs CRUD route focused on full-document writes.

**Markdown rendering hardened later — see Phase 3 notes.** Added `remark-frontmatter` to the unified pipeline in `lib/markdown.ts` so curated pages (with `---\n…\n---` YAML blocks) render without the frontmatter bleeding into the body. Affects both Phase 3 generated pages and Phase 4 personal pages.

### Phase 5 — Ask-Wiki Agent (MVP 2) ✓

Bedrock Nova 2 Lite agent in the chat panel, served from Next.js.

- [x] Route Handler: `POST /api/chat` with streaming (ReadableStream, NDJSON envelope)
- [x] Bedrock converse API via `@aws-sdk/client-bedrock-runtime` (`ConverseStreamCommand`)
- [x] Agent loop: read `index.md` (scope-aware catalog) → tool calls → answer with citations
- [x] Tools (direct function calls — no HTTP):
  - [x] `search_vault(query, limit?)` — Fuse.js search with scope post-filtering
  - [x] `read_document(doc_id)` — S3 GetObject + frontmatter parse
  - [x] `propose_page(slug, title, body)` — preview event + user-confirmed write via `POST /api/docs`
- [x] Scoped search — chat panel scope selector (`shared` / `user` / `both`, default `both`)
- [x] Agent proposes new pages only on explicit generation requests (Path A) + post-hoc Save-as-page routes through the Editor (Path B)
- [x] Refusal behavior on zero relevant hits — emits `{type: refuse, canForce: true}`, chat UI renders **Draft anyway (no sources)** button that re-issues the request with `forceUnsourcedGeneration: true`
- [x] Citations with deep links to docs — built deterministically from `read_document` calls, not from text parsing
- [x] Usage logging to `<scope>/_system/usage-log.jsonl`; chat persistence deferred

**Acceptance:** see `specs/phase-5-ask-wiki-agent.md` — 16 criteria, Implementation Notes section dated 2026-05-18.

#### Phase 5 implementation notes (drifts captured in spec)

Full notes in `specs/phase-5-ask-wiki-agent.md`. Headlines:

- **Force-unsourced is a system-prompt branch**, not a runtime flag inside the agent loop — `buildSystemPrompt` swaps the entire "Generation rules" section.
- **`runtime: 'nodejs'`** on `/api/chat` route — Vercel Edge's 60s timeout was too tight for 6-round tool-use loops; Node serverless gives 300s.
- **`DocumentType` mirrored locally** in `agent.ts` rather than depending on `@smithy/types` (transitive Smithy package not directly importable).
- **Citations are deterministic from `read_document` calls** — the route never parses model output for cites. No-hallucination guarantee enforced at the protocol level.
- **Post-hoc Save routes through the Editor** via a new `initialDraft` prop, not directly to `/api/docs`. Path A (implicit) and Path B (post-hoc) coexist.
- **Smoke checklist** at `web/lib/__smoke__/phase-5-agent.md` — 8 scenarios; runtime walk-through is the gate.

#### Known open follow-ups (not blocking MVP 2)

- Manual smoke walk-through still pending — typecheck + build are the only gates today.
- Editable slug in the propose-page preview (currently fixed by the agent).
- Web runtime needs `bedrock:InvokeModel*` IAM in whichever environment hosts it.

#### Phase 5 v2 patches landed (2026-05-18)

After the v1 postmortem caught 11 issues (1 scope-leak P1, 1 wrong-key-shape P1, 1 missing-history P1, plus 8 P2/P3), all 11 were fixed in a follow-up batch:
- Scope filter strict (was leaking via `.includes`)
- Relative `id` on `LiveDoc` (was sending full prefixed key)
- `useRef`-based text buffer (was abusing `setMessages` as sync getter)
- `AbortSignal` threaded into the Bedrock SDK call
- Chat panel sends history (multi-turn context)
- Warning event for uncited answers + UI banner
- Light inline Markdown during streaming
- Live activity indicator (`tool_use` events drive it)
- `propose_page` preview moved to CSS classes
- "Drafted from chat" tag in Editor
- Few-shot examples in system prompt

See `specs/phase-5-ask-wiki-agent.md` v2 fixes table for the full rundown.

### Phase 6 — SaaS (deferred, partially scaffolded)

Only after MVP 2 has been used in anger.

#### Already scaffolded (single-user-for-now, but contract is multi-tenant-ready)

The vault layout, scope plumbing, and per-user isolation primitives are already in place from the scope-aware refactor (see implementation notes below). Adding a second user is additive: introduce a current-user context, replace the hardcoded `DEFAULT_USER_ID` lookup in the Library modal, and the rest of the system already routes correctly.

- [x] S3 layout: `users/<id>/raw/`, `users/<id>/generated/<space>/`, `users/<id>/authored/<space>/`, `users/<id>/_system/` (mirror of shared roots)
- [x] Scope-aware backend: every route (`/api/upload`, `/api/raw`, `/api/curate/{start,status,cancel,finalize}`, `/api/reindex`) accepts `{ scope: 'shared' \| 'user', userId? }` and operates only inside the requested scope's prefix tree
- [x] Scope-aware Lambda: `CurateEvent` carries scope; manifest, job JSON, source-cards, and generated pages all land under the scope's `_system/` and `generated/`
- [x] Scope-aware index regeneration: `regenerateSpaceIndex`/`regenerateMasterIndex` take a `ScopePaths`; `regenerateIndexesForKey` infers scope from the key prefix; finalize and CRUD writes regenerate the right scope's indexes
- [x] Library modal scope toggle: Shared vs My, disabled while a job is running; destination toggle (raw — process with AI later — vs authored — final, no AI) replaces the legacy `subpath` flag
- [x] Sidebar scope toggle wired to the vault tree: `__user` synthetic folder contains all user content (personal + any other space the user has content in)

#### Still deferred for true multi-tenant SaaS

- Multi-tenant S3 layout (`tenants/<tenant>/users/<user>/`)
- Auth: Keycloak / OIDC / SAML
- Search backend swap to OpenSearch or Meilisearch
- RDS Postgres, EKS workers / SQS consumers
- Admin dashboard, billing, audit logs, tenant isolation
- Cross-tenant index isolation: today the in-memory Fuse search index walks all S3 objects regardless of scope. Multi-tenant requires scope-scoped search.
- S3 Event Notifications → Lambda/SQS for event-driven ingest (replace inline trigger from Phase 3)
- Event-driven ingest: S3 PutObject event on `*/raw/` → triggers ingest automatically (Lambda or background worker). Eliminates need for manual CLI runs or portal trigger buttons. Includes retry logic, dead-letter queue, and status reporting back to the portal.
- Vault structure schema (`structure.json`) improvements: UI for managing spaces (create/rename/reorder/delete), drag-and-drop file moves between spaces, per-space permissions, schema versioning and migration, validation on upload/write to enforce declared structure
- Per-user `structure.json`: today the space list is global. Each user gets their own space declarations once we have real multi-user. `personal` is currently a reserved space name that's only meaningful in user scope.

**Acceptance:** see `specs/phase-6-saas.md`

#### Scope-aware refactor — implementation notes

Shipped 2026-05-17 / 2026-05-18 as preparation for Phase 6. Surfaced via a single primitive (`ScopePaths`) and a thin `resolveScope()` helper mirrored in both `web/lib/scope.ts` and `infra/lambda/curate/scope.ts`.

**Vocabulary alignment.** Renamed the UI `Scope = 'shared' \| 'personal'` to `'shared' \| 'user'`. The sidebar's "personal" toggle was a vocabulary mismatch — `personal` is a *space*, not a scope. `SourceType = 'personal'` (a doc's origin) and the `personal` space name remain unchanged as orthogonal concepts.

**`DEFAULT_USER_ID` consolidated to two sources.** `web/lib/vault-paths.ts` exports the canonical web constant, used by the modal and tree builder. The Lambda has its own copy in `infra/lambda/curate/paths.ts` because it's bundled separately and can't share modules.

**Lambda contract is forward-compatible, not strictly backward-safe.** The `CurateEvent` `scope` field is optional and defaults to `'shared'` if absent. This means *old* web → *new* Lambda works correctly. But *new* web → *old* Lambda silently falls through to shared behavior, which corrupts shared paths when the user clicks "My". **Deploy the Lambda before shipping the web change**, or the cross-deploy window is a data-corruption risk. Adding a `curateEventVersion` field with a strict version check would prevent this — pending.

**`/api/curate` (single-file POST) removed.** The old upload flow invoked it per-file via an "Auto-index after upload" checkbox. The checkbox and route are deleted; raw files now go through the explicit Pending tab batch flow, authored files are finalized inline by `/api/upload`.

**Sidebar tree carries all user content under one synthetic folder.** `__user` contains a `Personal` subfolder (mapped to `authored/personal/`) plus one folder per declared space that has user content (mapped to `users/<id>/generated/<space>/` and `users/<id>/authored/<space>/`). Shared spaces are siblings of `__user` at the tree root. The sidebar scope toggle filters which side of the tree is shown. The declared-space loop skips `personal` to avoid double-listing entries already covered by the dedicated Personal block.

**Follow-up fixes shipped 2026-05-18:**
- **Manifest write serialization (P1).** Concurrent `processSource` workers under `CURATE_CONCURRENCY > 1` were each reading the same baseline `processed.json` and the last writer was silently dropping the others' entries. The Lambda now routes the manifest's read-modify-write through the same in-process write queue as the job-JSON updates.
- **Hash-based pending detection (P2).** `/api/curate/start` and `/api/raw` previously filtered raw keys only by manifest membership, missing re-uploads (same key, new content). Both routes now use a shared `resolvePending` helper (`web/lib/curate-pending.ts`) that hashes already-known keys in parallel and includes the modified ones. The Pending tab badge and the backend gate now agree.
- **New-page editor bug.** Clicking "New page" while a doc was open left the previous doc in component state, so the editor pre-filled the new doc with the previous one's title and body. Saving then 409'd on the slug collision. Fixed by passing `doc={undefined}` to the Editor when `activeId === '__new'`.
- **Editor error surfacing.** POST/PUT failures on `/api/docs` now surface the route's `detail` field in the toast instead of a generic "Failed to save" — users see the actual reason (e.g. *A page with slug "foo" already exists*).

**Known gaps from the scope-refactor postmortem still open:**
- No runtime smoke test of the user-scope path; only typecheck verified
- Mid-job scope change is prevented by disabling the toggle while running, but the modal closing + reopening discards the in-flight job (pre-existing)
- Finalize + CRUD writes are not serialized **across requests**; same-scope concurrent finalizes still race on `index.md` writes (in-Lambda concurrency was addressed, cross-request was not)
- `personal` as a reserved-name vs first-class declared space is unresolved
- Cross-deploy Lambda compatibility has no version guard; deploy Lambda before the web change

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

### Phase 8 — HTML Publishing & Visual Artifacts (deferred)

Derived presentation layer for Markdown vault content. This phase responds to the emerging AI-engineering pattern where finished human-facing deliverables are often better as HTML artifacts than raw Markdown, while preserving Vaultmark's core rule: **Markdown remains canonical; HTML is disposable and regenerable.**

#### Principles

- **Markdown remains source of truth.** Generated HTML must never become the authoritative editable document. Edits flow back to Markdown, not into generated HTML.
- **HTML is a derived artifact.** It can be regenerated from Markdown, frontmatter, citations, and deterministic templates at any time.
- **Default to deterministic rendering.** Use code-owned templates and renderers first. AI may propose layout metadata or summaries, but raw model-authored HTML is not trusted by default.
- **Safe by default.** Sanitize generated HTML. Block arbitrary scripts in the MVP export path unless a trusted, explicit export mode is added later.
- **Human-facing output.** Optimize for shareable reports, visual briefs, runbooks, dashboards, and article-like pages where HTML adds real value over Markdown.

#### Proposed S3 layout

```
s3://<bucket>/<vault-prefix>/
  _site/
    shared/<space>/...      # derived HTML for shared docs
    users/<user-id>/<space>/...  # derived HTML for user-scoped docs
    assets/                 # copied/generated static assets for published pages
    manifest.json           # generated artifact manifest
```

Open question before implementation: whether `_site/` should be public-shareable in OSS deployments or private-only behind the same portal access path.

#### Scope

- [ ] Route Handler: `POST /api/publish/html` generates HTML for one Markdown document.
- [ ] Route Handler: `POST /api/publish/html/space` generates HTML for a declared space.
- [ ] Route Handler or CLI command for whole-vault export, gated behind an explicit confirmation.
- [ ] Template system for document, index, report, and generated-article pages.
- [ ] Generated page metadata links back to canonical Markdown key, source checksum/ETag, generation timestamp, and template version.
- [ ] HTML pages include TOC, frontmatter metadata, citation backlinks, source/provenance badge, and responsive styling.
- [ ] Space export generates an HTML index page plus one HTML page per navigable Markdown doc.
- [ ] Optional visual blocks: callouts, collapsible sections, tables, lightweight charts, and timeline sections derived from Markdown/frontmatter.
- [ ] Publish manifest tracks every generated HTML artifact and its source Markdown key.
- [ ] Regeneration invalidates stale HTML when source Markdown checksum/ETag changes.
- [ ] Download/open affordance in the portal for generated HTML artifacts.
- [ ] Smoke tests for XSS sanitization, broken links, source checksum drift, and responsive layout.

#### AI-assisted layout

Later in this phase, the ask-wiki agent may propose a page presentation plan:

```json
{
  "template": "report",
  "blocks": [
    { "type": "summary", "sourceHeading": "Overview" },
    { "type": "timeline", "sourceHeading": "History" },
    { "type": "table", "sourceHeading": "Service Matrix" }
  ]
}
```

The renderer owns HTML generation. The model supplies structured intent, not executable markup.

#### Acceptance Criteria

1. A user can generate a static HTML page from one Markdown document without changing the source Markdown.
2. A user can generate static HTML for a space, including an index page and all navigable docs in that space.
3. Generated HTML lands under `_site/` and includes a manifest entry mapping it to the canonical Markdown key.
4. Generated HTML includes canonical source metadata: source key, title, source type, checksum/ETag, generated timestamp, and template version.
5. Search, chat, and editor read paths continue using Markdown/S3 source documents, not generated HTML.
6. Unsafe HTML and scripts are stripped or blocked by default.
7. Regeneration is deterministic for the same Markdown input, template version, and layout metadata.
8. Stale HTML is detectable when the source Markdown checksum/ETag changes.
9. Portal UI can open or download the generated HTML artifact.
10. Visual smoke checks pass for desktop and mobile widths.

#### Out of Scope For This Phase

- Replacing Markdown as the editable source format.
- Autonomous agent writes of raw HTML.
- Public publishing workflow with custom domains, CDN invalidation, or anonymous access controls.
- Full website builder / theme marketplace.
- JavaScript-heavy interactive apps inside generated pages.

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
