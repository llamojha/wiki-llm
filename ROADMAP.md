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

## Phases

### Phase 0 — Skeleton

Just enough scaffolding to start Phase 1.

- [ ] pnpm workspace at repo root
- [ ] `web/` — Next.js 16.2 + React 19 + TypeScript strict
- [ ] `next/font` configured for IBM Plex Sans, IBM Plex Serif, JetBrains Mono (replace prototype's Google Fonts CDN)
- [ ] Drop `portal/styles.css` into `web/app/globals.css` (verbatim, for parity)
- [ ] Confirm dev server renders an empty shell with the right fonts and theme tokens
- [ ] `README.md` rewritten for Vaultmark (this PR)
- [ ] `ROADMAP.md` (this PR)

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

### Phase 2 — Demo (real read path)

Backend joins. Real S3 read, real search.

- [ ] `api/` — FastAPI 0.136 + Python 3.13 + uv
- [ ] `infra/docker-compose.yml` — Postgres 17 + api + web
- [ ] DB schema: `vaults`, `documents`, `search_records` (per PRD §10)
- [ ] S3 read client (boto3); list + get
- [ ] Markdown render server-side with sanitization (`remark` + `rehype-sanitize`)
- [ ] Postgres FTS index, populated from S3 listing
- [ ] FastAPI endpoints: `GET /vaults`, `GET /vaults/{id}/tree`, `GET /docs/{id}`, `GET /search`
- [ ] Wire `web/` to the API; remove mock fallbacks from production paths
- [ ] CI: lint + typecheck + build for both packages

**Acceptance:** PRD §13 Demo criteria green against a real S3 bucket.

### Phase 3 — MVP 1

Full personal product. Write path, indexing, sanitization hardening.

- [ ] Personal wiki CRUD: create / edit / delete; rename optional
- [ ] S3 write with optimistic concurrency (checksum-based)
- [ ] Frontmatter parsing as canonical metadata source
- [ ] `index.md` regenerator triggered on every write
- [ ] `log.md` append on every meaningful event (PRD §13 hint)
- [ ] Indexing refresh job — manual trigger + on-write
- [ ] Sanitization audit, document allowed tags
- [ ] Markdown rendering: headings, links, images, fenced code, tables, frontmatter, heading anchors (FR2)
- [ ] Setup docs: connect-a-bucket guide, IAM policy template
- [ ] Optional: EKS manifests under `infra/eks/`

**Acceptance:** PRD §13 MVP 1 criteria green.

### Phase 4 — Revive ingest pipeline

Bridge from `legacy/wiki.py` to a real `generated/` worker. Parallelizable with late Phase 3.

- [ ] Port `wiki.py` core out of `legacy/` into a `worker/` (or `api/workers/`) container
- [ ] Replace filesystem I/O with S3 reads/writes against the configured vault
- [ ] Output to `generated/` prefix; metadata `source_type = generated`
- [ ] Update `index.md` after each ingest run
- [ ] Bedrock model still pinned to `amazon.nova-2-lite-v1:0`; configurable per env
- [ ] CLI entrypoint: `vaultmark ingest <s3-key>` and `vaultmark lint`
- [ ] Dockerfile + Compose service entry

**Acceptance:** drop a Markdown into `raw/`, run the worker, see structured pages in `generated/` and indexed in the portal.

### Phase 5 — MVP 2 (ask-wiki agent)

Full Bedrock Nova 2 Lite agent embedded in the chat panel.

- [ ] FastAPI `/chat` endpoint; streaming
- [ ] Bedrock client (boto3) targeting `amazon.nova-2-lite-v1:0`
- [ ] Agent loop: read `index.md` → tool calls → answer with citations
- [ ] Tools:
  - [ ] `search_vault(query, scope)` — Postgres FTS
  - [ ] `read_document(doc_id)` — full Markdown
  - [ ] `propose_page(slug, title, body)` — emits a confirmation card; user-confirmed write only
- [ ] Refusal behavior on zero relevant hits
- [ ] Scope selection: all / folder / page (PRD FR7)
- [ ] Citations rendered in `ChatPanel` with deep links to docs
- [ ] Usage logging (per PRD MVP 2 capabilities)

**Acceptance:** PRD §13 MVP 2 criteria green.

### Phase 6 — SaaS (deferred)

Only after MVP 1 has been used in anger.

- Multi-tenant S3 layout (`tenants/<tenant>/users/<user>/`)
- Auth: Keycloak / OIDC / SAML
- Search backend swap to OpenSearch or Meilisearch
- RDS Postgres, EKS workers / SQS consumers
- Admin dashboard, billing, audit logs, tenant isolation

## Out of scope (forever, or until reconsidered)

- Real-time collaborative editing
- Vector search / RAG embedding pipelines
- Autonomous agent writes (every write is user-confirmed)
- Multi-agent orchestration
- PDF / DOCX ingestion
- Public publishing workflow

## Where the legacy fits

`legacy/wiki.py` is earmarked as the seed for Phase 4. Until then, treat `legacy/` as frozen reference. Don't import from it; port out of it.
