---
title: Vaultmark Tech Stack
inclusion: always
---

# Vaultmark Tech Stack

All versions pinned to 2026. Do not upgrade without updating this file and CLAUDE.md.

## Frontend (`web/`)

| Technology | Version | Purpose |
|---|---|---|
| Next.js | 16.2 | App Router, Turbopack, RSC |
| React | 19 | UI framework |
| TypeScript | 5.7+ | Type safety, strict mode |
| Plain CSS | — | Ported from `portal/styles.css` |
| `next/font` | — | IBM Plex Sans/Serif, JetBrains Mono |
| remark + rehype-sanitize | latest | Markdown rendering pipeline |
| pnpm | latest | Package manager |

## Backend (`api/`)

| Technology | Version | Purpose |
|---|---|---|
| Python | 3.13 | Runtime |
| FastAPI | 0.136+ | HTTP framework |
| Pydantic | 2.x | Request/response validation |
| SQLAlchemy | 2.x | ORM + query builder |
| Alembic | latest | Database migrations |
| boto3 | latest | S3 + Bedrock SDK |
| Ruff | latest | Lint + format |
| Pyright | latest | Type checking |
| uv | latest | Package manager |

## Data Layer

| Technology | Version | Purpose |
|---|---|---|
| PostgreSQL | 17 | Metadata + full-text search |
| AWS S3 | — | Markdown blob storage (source of truth) |
| SQLite | — | Acceptable for single-user local mode |

## LLM (MVP 2)

| Technology | Model ID | Purpose |
|---|---|---|
| Amazon Bedrock | `amazon.nova-2-lite-v1:0` | Ask-wiki agent |
| Cross-region profile | `us.amazon.nova-2-lite-v1:0` | When home region requires it |

Context: 1M tokens. Keep `index.md` + active scope in prompt; use agent tools for full-doc reads.

## Infrastructure

| Technology | Purpose |
|---|---|
| Docker Compose | Local dev (Postgres + MinIO + api + web) |
| EKS | Future SaaS deployment |

## Explicitly Out of Scope

- Tailwind CSS or any UI component library
- Vector databases or embedding pipelines
- Claude API or non-Bedrock LLMs
- Multi-agent orchestration
- MinIO/R2 abstraction layer (S3 only per decisions log)
