---
title: Vaultmark Conventions
inclusion: always
---

# Vaultmark Conventions

## Naming

- **Files:** kebab-case for all source files (`doc-reader.tsx`, `search-service.py`).
- **Components:** PascalCase React components (`DocReader`, `SearchPalette`).
- **Python:** snake_case for modules, functions, variables. PascalCase for classes.
- **Routes:** kebab-case URL segments (`/vaults/{id}/tree`).
- **S3 keys:** lowercase with `/` separators. No spaces or special characters.

## Project Structure

### Frontend (`web/`)

```
web/
├── app/                   Next.js App Router pages + layouts
├── components/            Shared UI components
├── lib/
│   ├── mock/              Mock data (dev only)
│   └── icons.tsx          Icon components
└── styles/                Global CSS (ported from portal/)
```

### Backend (`api/`)

```
api/
├── routers/               FastAPI route modules
├── models/                Pydantic request/response models
├── db/
│   ├── models.py          SQLAlchemy ORM models
│   └── migrations/        Alembic migrations
├── services/              Business logic (S3, search, agent)
└── main.py                FastAPI app entry
```

## Import Rules

- Frontend: absolute imports from `@/` (mapped to `web/`).
- Backend: relative imports within packages; absolute from project root.
- Never import from `portal/` or `legacy/` in production code.
- Mock imports gated behind `process.env.NODE_ENV === 'development'` or equivalent.

## Component Patterns

- Server Components by default. Add `'use client'` only when state/effects/event handlers are needed.
- Co-locate component CSS with the component when it's component-specific.
- Props interfaces named `{ComponentName}Props`.
- No barrel exports (`index.ts` re-exports) unless the module has 3+ public exports.

## API Patterns

- All endpoints return Pydantic models.
- Use HTTP status codes correctly (201 for creation, 404 for missing, 409 for conflicts).
- Path params for resource identity, query params for filtering/pagination.
- Consistent error response shape: `{ "detail": "message" }`.

## Git Conventions

- Branch naming: `phase-{n}/{feature-slug}` (e.g., `phase-1/port-sidebar`).
- Commit messages: imperative mood, under 72 chars (`Port sidebar component from prototype`).
- One logical change per commit.
- Squash-merge feature branches into main.

## Environment & Config

- All secrets via environment variables. Never hardcode.
- `.env.local` for local dev (gitignored).
- Docker Compose `.env` for container config.
- Config shape documented in `CLAUDE.md`.

## Error Handling

- Frontend: error boundaries at route level. Show user-friendly messages.
- Backend: raise `HTTPException` with appropriate status codes. Log full context.
- Never swallow errors silently. Surface them clearly.
- S3 operations: handle `NoSuchKey`, `PreconditionFailed` (checksum mismatch) explicitly.
