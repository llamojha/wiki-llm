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
- **Navigation from `index.md`** — `index.md` is the canonical nav structure; folder hierarchy is the fallback for pages not listed in `index.md`.
- **Mocks stay** — Editor and ChatPanel remain mock-backed. Only read and search paths go real. Mocks are replaced incrementally per phase and removed at final launch.
- **No write in Demo** — the PRD Demo criterion "create one personal wiki page" is deferred to Phase 4.

## Acceptance Criteria

1. `docker compose up` starts Postgres 17, the FastAPI backend, and the Next.js frontend with no manual steps beyond env config.
2. `GET /vaults` returns the configured vault(s).
3. `GET /vaults/{id}/tree` returns the document tree derived from `index.md`, falling back to S3 folder hierarchy for unlisted pages.
4. `GET /docs/{id}` returns a single document's metadata and rendered HTML (server-side Markdown → HTML via remark + rehype-sanitize).
5. `GET /search?q=<term>` returns ranked results from Postgres full-text search.
6. The frontend renders the vault tree, document content, and search results using API data. Editor and Chat remain mock-backed.
7. Postgres FTS index is populated from an S3 bucket listing on startup or manual trigger.
8. CI pipeline passes: lint + typecheck + build for both `web/` and `api/`.
9. Unsafe HTML in Markdown is stripped by rehype-sanitize; no XSS vectors in rendered output.
10. Page render latency under 500ms for cached pages.
11. Search latency under 1 second for small vaults (< 100 pages).
12. Time to connect a vault (env config + docker compose up): under 10 minutes.
