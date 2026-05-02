---
title: Vaultmark Development Standards
inclusion: always
---

# Vaultmark Development Standards

## Frontend Standards (web/)

- Next.js 16.2 with App Router and React Server Components by default.
- Client Components only where interactivity demands it (sidebar tree, search palette, editor, chat panel).
- TypeScript strict mode (`strict: true`). No `any` types without explicit justification.
- Plain CSS only — port `portal/styles.css` as-is. No Tailwind, no UI library.
- `next/font` for IBM Plex Sans, IBM Plex Serif, and JetBrains Mono.
- Package manager: pnpm.
- Lint and typecheck must pass before merge.

## Backend Standards (api/)

- Python 3.13 with FastAPI 0.136+.
- Pydantic 2.x for all request/response models.
- SQLAlchemy 2.x + Alembic for database migrations.
- `boto3` for S3 and Bedrock integration.
- Ruff for lint + format, Pyright for typecheck.
- Package manager: uv.
- All endpoints must have type annotations and Pydantic models.

## Code Quality

- Never create duplicate files with suffixes like `_fixed`, `_clean`, `_backup`.
- Work iteratively on existing files.
- Keep functions small and focused on single responsibilities.
- Implement proper error handling — surface problems clearly, don't swallow them.
- Use meaningful variable and function names that communicate purpose.
- Include relevant documentation links in code comments where helpful.

## Markdown Rendering

- Use `remark` + `rehype-sanitize` pipeline for all Markdown rendering.
- Never use `dangerouslySetInnerHTML` with raw user content.
- Must support: headings, links, images, fenced code blocks, tables, frontmatter, heading anchors.
- Sanitize unsafe HTML — document allowed tags explicitly.

## S3 & Data Conventions

- Markdown in S3 is the source of truth. Postgres is metadata + search index only.
- Frontmatter is canonical metadata. When frontmatter and DB disagree, frontmatter wins; reindex.
- One vault, one bucket, one prefix. Code should never assume a global bucket.
- S3 writes use optimistic concurrency (checksum-based).
- `source_type` metadata distinguishes `authored | uploaded | generated`.

## Mock Data & Development

- Mock data belongs under `web/lib/mock/` only.
- Mock imports are only allowed in dev/storybook contexts.
- No mock fallbacks in production paths.
- `portal/` is the design reference — read it before re-deriving decisions.

## File Management

- Use relative paths from project root in commands and file operations.
- Maintain clean directory structures matching the target architecture.
- Use consistent naming conventions across the project.
- Keep configuration files at appropriate levels.

## Testing

- Write tests for new functionality.
- Frontend: lint + typecheck + build as the minimum gate.
- Backend: pytest with Ruff check + Pyright as the minimum gate.
- Run tests before committing changes.

## Version Control

- Commit frequently with meaningful messages.
- Use feature branches for development.
- Keep main branch deployable at all times.
- Use `.gitignore` to exclude generated files and secrets.

## Documentation

- `CLAUDE.md` is the codebase operating guide — keep it current.
- `ROADMAP.md` is the engineering plan — phases are the contract.
- Update docs when upgrading dependencies or changing architecture.
- Keep documentation close to relevant code.
