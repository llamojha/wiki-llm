# Phase 2 — Real Read Path

**Milestone:** Demo (with Phase 0 + Phase 1)

## Goal

Replace mock data with a live backend that reads Markdown from S3 and serves it through a real API, making the portal a functional read-only viewer of an actual vault.

## Vision

A developer points Vaultmark at their S3 bucket (via env config), runs `docker compose up`, and browses their Markdown vault in the portal — rendered, searchable, and fast.

## Objective

Stand up the FastAPI backend, Postgres metadata layer, and S3 read client. Wire the Next.js frontend to the API for read and search paths. Editor and Chat remain mock-backed until their phases ship.

## Key Decisions

- **No vault connection UI** — always env/config based. This is a developer tool.
- **Navigation from `index.md`** — `index.md` is the canonical nav structure; folder hierarchy is the fallback for pages not listed in `index.md`. Format pinned in `specs/index-md-format.md`.
- **Rendering in Next.js RSC** — the API returns raw Markdown; the frontend renders it via remark + rehype-sanitize. Keeps the rendering stack in one place.
- **Mocks stay** — Editor and ChatPanel remain mock-backed. Only read and search paths go real. Mocks are replaced incrementally per phase and removed at final launch.
- **No write in Demo** — the PRD Demo criterion "create one personal wiki page" is deferred to Phase 4.

## Background

- `web/lib/markdown.tsx` is currently a minimal hand-rolled renderer (handles h1–h3, lists, code fences, bold, inline code). It is explicitly marked as a placeholder for Phase 2's remark + rehype-sanitize pipeline.
- The legacy `wiki/index.md` uses a table-based catalog format (Sources / Entities / Concepts / Analyses sections). This is the wiki-llm ingest catalog — **not** a navigation tree. Phase 2 uses a new, simpler nav format documented in `specs/index-md-format.md`.
- `globals.css` contains all prose styles. The remark pipeline must produce HTML that matches the CSS selectors already in use — this needs explicit verification before parity sign-off.

## Acceptance Criteria

1. `docker compose up` starts Postgres 17, the FastAPI backend, and the Next.js frontend with no manual steps beyond env config.
2. `GET /vaults` returns the configured vault(s).
3. `GET /vaults/{id}/tree` returns the document tree derived from `index.md`, falling back to S3 folder hierarchy for unlisted pages.
4. `GET /docs/{id}` returns a single document's metadata and raw Markdown.
5. `GET /search?q=<term>` returns ranked results from Postgres full-text search.
6. The frontend renders the vault tree, document content, and search results using API data. Editor and Chat remain mock-backed.
7. Postgres FTS index is populated from an S3 bucket listing on startup or manual trigger.
8. CI pipeline passes: lint + typecheck + build for both `web/` and `api/`.
9. Unsafe HTML in Markdown is stripped by rehype-sanitize; no XSS vectors in rendered output.
10. Page render latency under 500ms for cached pages.
11. Search latency under 1 second for small vaults (< 100 pages).
12. Time to connect a vault (env config + docker compose up): under 10 minutes.
13. Visual parity script passes for all doc-reader scenarios after switching from mock JSX bodies to rendered Markdown HTML.

## Task Breakdown

### Task 1: `api/` project scaffold + pin `index.md` nav format + `/vaults` and `/vaults/{id}/tree`

**Objective:** Stand up a minimal FastAPI app and lock the `index.md` navigation tree format before any code depends on it.

**Implementation guidance:**
- Pin `index.md` nav format first — document in `specs/index-md-format.md` (a flat Markdown list of relative S3 keys, optionally indented for folder grouping). The API parses this list to build the tree; any S3 key not listed falls into an "Unlisted" folder at the bottom.
- `uv init api/` with `pyproject.toml`; pin FastAPI 0.136, uvicorn, boto3, python-frontmatter, pydantic 2.x, ruff, pyright
- `api/app/main.py`, `api/app/config.py` (Pydantic BaseSettings: `VAULT_BUCKET`, `VAULT_PREFIX`, `VAULT_REGION`, `AWS_*` creds, `DATABASE_URL`)
- `api/app/routers/vaults.py` — `GET /vaults`, `GET /vaults/{id}/tree` (reads `index.md` from S3, parses nav list, falls back to folder hierarchy)
- Response models: `VaultSummary`, `TreeNode` (discriminated `doc | folder`)
- Tests: pytest + moto; fixture bucket with a sample `index.md` and a few `.md` files

**Demo:** `GET /vaults/{id}/tree` returns a correctly structured tree from a mocked S3 bucket with a known `index.md`.

---

### Task 2: S3 read client + `GET /docs/{id}` (raw Markdown + metadata) + remark pipeline

**Objective:** Fetch a Markdown file from S3 and return raw Markdown + parsed frontmatter metadata. Replace the hand-rolled renderer in `web/lib/markdown.tsx` with a real remark + rehype-sanitize pipeline.

**Implementation guidance:**
- `api/app/s3.py` — `S3Client`: `get_object(key) → str`, `list_objects(prefix) → list[str]`
- `api/app/routers/docs.py` — `GET /docs/{id}` returns `{id, title, path, s3_key, source_type, updated, author, tags, checksum, raw_markdown}`
- Parse frontmatter with `python-frontmatter`; fall back to key-derived title if absent
- `web/lib/markdown.ts` — replace the hand-rolled renderer with remark + rehype-sanitize: `renderMarkdown(raw: string): Promise<string>` returning sanitized HTML. Add `remark`, `remark-gfm`, `rehype-sanitize`, `remark-rehype` to `web/package.json`.
- Tests: moto for S3; fixture `.md` files with and without frontmatter; unit tests for `renderMarkdown` covering headings, code blocks, inline elements, links

**Demo:** `GET /docs/{id}` returns raw Markdown for a real S3 file. `renderMarkdown` unit tests pass for all element types.

---

### Task 3: Postgres metadata layer + FTS index + `GET /search`

**Objective:** Stand up the DB schema, populate it from S3 on startup, and serve full-text search.

**Implementation guidance:**
- `api/app/db.py` — SQLAlchemy async engine + session factory
- Alembic migration: `vaults(id, bucket, prefix, region)`, `documents(id, vault_id, s3_key, title, path, source_type, updated, author, tags, checksum, body_text, fts_vector tsvector generated always as (to_tsvector('english', title || ' ' || body_text)) stored)`
- `api/app/indexer.py` — `index_vault(vault_id)`: list S3 keys → fetch each → parse frontmatter → strip Markdown to plain text → upsert `documents`
- Startup hook: `asyncio.create_task(index_vault(...))` — non-blocking, logs progress
- `GET /search?q=<term>&vault_id=<id>` — `WHERE fts_vector @@ plainto_tsquery('english', :q)` ranked by `ts_rank`
- Tests: pytest-asyncio + real Postgres test DB; test FTS ranking with known fixtures

**Demo:** `GET /search?q=<term>` returns ranked results from a real indexed vault. Startup logs show indexing progress.

---

### Task 4: `infra/docker-compose.yml` — full local stack

**Objective:** One command brings up Postgres 17 + api + web.

**Implementation guidance:**
- `infra/docker-compose.yml`: services `db` (postgres:17), `api` (build `../api`, port 8000), `web` (build `../web`, port 3000, `NEXT_PUBLIC_API_URL=http://api:8000`)
- `infra/.env.example`: all required vars documented (`VAULT_BUCKET`, `VAULT_PREFIX`, `VAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`)
- `api/Dockerfile`: uv install, non-root user
- `web/Dockerfile`: Next.js standalone output
- Health checks on `db` and `api`; `web` depends on `api` healthy
- `README.md` quick-start section: `cp infra/.env.example infra/.env && docker compose up`

**Demo:** `docker compose up` → stack starts, all health checks pass, `localhost:3000` loads.

---

### Task 5: Wire `web/` read + search paths to the API + prose parity verification

**Objective:** Replace mock data in read and search paths with live API calls. Verify rendered Markdown prose is visually identical to the prototype. Editor and Chat stay mock-backed.

**Implementation guidance:**
- `web/lib/api.ts` — typed fetch client: `getVaults()`, `getTree(vaultId)`, `getDoc(docId)`, `search(q)`; reads `NEXT_PUBLIC_API_URL`
- `app/page.tsx` (RSC) fetches `getTree()` server-side and passes `initialTree` prop to `AppShell`
- `AppShell` accepts `initialTree` prop; sidebar renders from it instead of mock `DOCS`
- On `openDoc(id)`: client-side `getDoc(id)` fetch → `renderMarkdown(raw_markdown)` → inject via `dangerouslySetInnerHTML` inside `.doc-body` wrapper
- `SearchPalette` calls `search(q)` with 150ms debounce; add a minimal loading indicator
- **Prose parity check:** after wiring, run the existing visual parity script against the prototype for all doc-reader scenarios. Specifically verify: heading levels, `<code>` inline, `<pre><code>` blocks, `<ul>/<ol>`, `<strong>/<em>`, `<a>` links. Fix any CSS selector mismatches in `globals.css` before sign-off.
- `GeneratedDoc` and Editor remain wired to mock/local state

**Demo:** Real S3 vault browsable end-to-end. Visual parity script passes for all doc-reader scenarios. Search returns live results.

---

### Task 6: CI pipeline

**Objective:** GitHub Actions CI runs lint + typecheck + build for both packages on every push.

**Implementation guidance:**
- `.github/workflows/ci.yml`: two jobs — `web` (pnpm install, `next lint`, `tsc --noEmit`, `next build`) and `api` (uv sync, `ruff check`, `pyright`, `pytest`)
- Cache pnpm store and uv cache
- CI uses moto for AWS — no real S3 access in CI
- Both jobs must pass; blocks merge to main

**Demo:** Push to branch → CI green on both jobs in GitHub Actions.
