---
title: Vaultmark Architecture
inclusion: always
---

# Vaultmark Architecture

> **Status note (June 2026):** this doc describes the original two-service
> FastAPI/Postgres design. After Phase 2 the deployed architecture pivoted to
> a **single Next.js app** (Route Handlers + S3 + in-memory search) — see
> `ROADMAP.md` and `CLAUDE.md` for current state. Keep this design in mind
> for Phase 6 (SaaS), where a separate backend may return.

## System Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  web/ (Next)│────▶│ api/ (Fast) │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                          ┌────────────────────┼────────────────────┐
                          ▼                    ▼                    ▼
                    ┌───────────┐      ┌─────────────┐     ┌─────────────┐
                    │ Postgres  │      │     S3      │     │   Bedrock   │
                    │ (metadata │      │ (Markdown   │     │ (Nova 2     │
                    │  + search)│      │  blobs)     │     │  Lite)      │
                    └───────────┘      └─────────────┘     └─────────────┘
```

## Layer Responsibilities

### Frontend (`web/`)

- Renders the portal UI (browse, search, edit, chat).
- Server Components by default; Client Components for interactive panels.
- Calls `api/` for all data. Never accesses S3 or Postgres directly.
- Handles Markdown → HTML rendering via remark pipeline (server-side).

### Backend (`api/`)

- Serves REST endpoints for vault operations.
- Manages S3 reads/writes, Postgres metadata, and search indexing.
- Hosts the Bedrock agent loop (MVP 2).
- Enforces data integrity (frontmatter ↔ DB sync, checksum concurrency).

### Storage (S3)

- Source of truth for all document content.
- Layout: `raw/`, `wiki/`, `generated/`, `assets/`, `index.md`, `log.md`.
- One vault = one bucket + one prefix.

### Metadata (Postgres)

- Stores document metadata, vault config, search records.
- Full-text search index (Postgres FTS).
- Never stores document content — only indexes it.

### LLM (Bedrock)

- Nova 2 Lite agent for ask-wiki (MVP 2).
- Tools: `search_vault`, `read_document`, `propose_page`.
- All writes are user-confirmed proposals, never autonomous.

## Data Flow

### Read Path

```
Browser → web/ (RSC) → api/ GET /docs/{id} → S3 GetObject → render Markdown → HTML
```

### Write Path

```
Browser → web/ (editor) → api/ PUT /docs/{id} → S3 PutObject (checksum) → reindex Postgres
```

### Search Path

```
Browser → web/ (palette) → api/ GET /search?q= → Postgres FTS → results
```

### Chat Path (MVP 2)

```
Browser → web/ (chat panel) → api/ POST /chat → Bedrock agent loop
  → tool: search_vault → Postgres FTS
  → tool: read_document → S3 GetObject
  → tool: propose_page → confirmation card → user approves → S3 PutObject
```

## Repo Layout

```
wiki-llm/
├── web/                   Next.js portal
├── api/                   FastAPI backend
├── infra/
│   ├── docker-compose.yml Local dev stack
│   └── eks/               K8s manifests (future)
├── portal/                Design prototype (deleted after parity)
├── legacy/                Archived wiki-llm (frozen)
├── CLAUDE.md              Codebase guide
├── ROADMAP.md             Engineering plan
└── prd_*.md               Product spec
```

## Key Boundaries

- `vault_id → (bucket, prefix)` is the isolation boundary between user content and infra.
- Frontend never touches S3 or DB directly.
- Mock data (`web/lib/mock/`) is dev-only; never imported in production paths.
- `portal/` is read-only reference until parity sign-off.
- `legacy/` is frozen; port out of it, don't import from it.
