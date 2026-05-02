# Vaultmark

An S3-backed Markdown knowledge portal for individuals and engineering teams.

Markdown in object storage is the durable knowledge layer. The portal renders, searches, and (in MVP 2) lets a Bedrock-powered agent answer questions grounded in your own documents.

> Vaultmark — an S3-backed Markdown vault for people, pipelines, and agents.

## Status

Pre-alpha. Mid-pivot from `wiki-llm` (a CLI + Bedrock vault maintainer) into a portal product.

- **Product spec:** [`prd_vaultmark_markdown_llm_wiki.md`](prd_vaultmark_markdown_llm_wiki.md)
- **Engineering plan:** [`ROADMAP.md`](ROADMAP.md)
- **Codebase guide (for contributors and Claude):** [`CLAUDE.md`](CLAUDE.md)
- **Design prototype:** [`portal/`](portal/) — the in-browser React mock that's being ported into `web/`
- **Legacy `wiki-llm`:** [`legacy/`](legacy/) — archived; will be revived as the `generated/` ingest pipeline (Phase 4)

## What it does

- **Vault:** Markdown stored in an S3 bucket and prefix you own.
- **Portal:** browse, render, search, and edit your vault from a clean Next.js UI.
- **Personal wiki:** create and maintain your own pages alongside shared/team content.
- **Ask-wiki agent (MVP 2):** a Bedrock Nova 2 Lite agent that reads your `index.md`, searches the vault, cites its sources, and refuses when no relevant content exists. Every page write is user-confirmed.

## Stack

- **Frontend:** Next.js 16.2, React 19, TypeScript 5.7+
- **Backend:** FastAPI 0.136+, Python 3.13
- **Storage:** AWS S3 (Markdown blobs)
- **Metadata + search:** Postgres 17 (full-text search)
- **LLM:** Amazon Bedrock — Nova 2 Lite (`amazon.nova-2-lite-v1:0`)
- **Local dev:** Docker Compose
- **SaaS deployment (future):** EKS

See [`CLAUDE.md`](CLAUDE.md) for the full pinned stack and conventions.

## Repo layout

```
wiki-llm/                          (repo; product name is Vaultmark)
├── prd_vaultmark_markdown_llm_wiki.md   Product spec
├── ROADMAP.md                           Engineering plan
├── CLAUDE.md                            Codebase guide
├── README.md                            This file
├── portal/                              JSX prototype (design reference)
├── web/                                 Next.js portal (Phase 0+)
├── api/                                 FastAPI backend (Phase 2+)
├── infra/                               Docker Compose, EKS manifests (Phase 2+)
└── legacy/                              Archived wiki-llm (frozen reference)
```

`web/`, `api/`, and `infra/` are created as their phases come online — see the roadmap.

## Getting started

The Next.js portal is the first thing being built. Once the Phase 0 scaffold is in:

```bash
pnpm install
pnpm --filter web dev   # http://localhost:3000
```

API and Compose instructions land with Phase 2.

## Contributing

This is a personal project in active design. The roadmap is the contract; deviations need a conversation. Read the PRD and the roadmap before opening an issue or PR.

## License

TBD.
