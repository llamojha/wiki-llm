# Vaultmark

An S3-backed Markdown knowledge portal for individuals and engineering teams.

Markdown in object storage is the durable knowledge layer. The portal renders, searches, and lets a Bedrock-powered agent answer questions grounded in your own documents.

> Vaultmark — an S3-backed Markdown vault for people, pipelines, and agents.

## Status

Early MVP. Phases 0-5 are implemented in the single Next.js app shape tracked by `ROADMAP.md`: S3 read/search, personal wiki CRUD, Lambda-backed curation, and the Bedrock ask-wiki agent.

- **Product spec:** [`prd_vaultmark_markdown_llm_wiki.md`](prd_vaultmark_markdown_llm_wiki.md)
- **Engineering plan:** [`ROADMAP.md`](ROADMAP.md)
- **Codebase guide:** [`CLAUDE.md`](CLAUDE.md)

## What it does

- **Vault:** Markdown stored in an S3 bucket and prefix you own. Source of truth lives in object storage, not a database.
- **Portal:** browse, render, and search your vault from a clean Next.js UI.
- **Personal wiki:** create and maintain your own pages alongside project or team content.
- **Ask-wiki agent (Phase 5):** a Bedrock Nova 2 Lite agent that reads your vault, cites sources, and proposes new pages — every write is user-confirmed.

## Stack

| Layer | Technology |
|---|---|
| App | Next.js 16.2, React 19, TypeScript 5.7+ |
| API | Next.js Route Handlers (server-side) |
| Storage | AWS S3 (Markdown blobs) |
| Search | In-memory fuzzy search (Fuse.js) |
| LLM | Amazon Bedrock — Nova 2 Lite (`amazon.nova-2-lite-v1:0`) |
| Deploy | Vercel, Docker, or any Node.js host |

## Repo layout

```
wiki-llm/
├── web/          Next.js portal (frontend + API route handlers)
├── api/          FastAPI backend (archived — replaced by Route Handlers)
├── infra/        Docker Compose for local dev
├── specs/        Phase acceptance specs
├── legacy/       Archived wiki-llm CLI (frozen reference)
├── ROADMAP.md    Engineering plan — phases are the contract
├── CLAUDE.md     Codebase guide for contributors
└── prd_vaultmark_markdown_llm_wiki.md   Product spec
```

## Getting started

### Prerequisites

- Node.js 22+ and pnpm
- AWS credentials with S3 access

### Local dev

```bash
# Install dependencies
pnpm install

# Set env vars
cp infra/.env.example web/.env.local
# Edit web/.env.local with your S3 bucket/prefix

# Start the app
pnpm dev   # http://localhost:3000
```

### Environment variables

Create `web/.env.local`:

```
VAULT_BUCKET=your-s3-bucket
VAULT_PREFIX=your-prefix
VAULT_REGION=us-east-1
BEDROCK_MODEL=amazon.nova-2-lite-v1:0
```

AWS credentials are picked up from the standard chain (`~/.aws/credentials`, instance role, env vars). No hardcoding.

## S3 vault layout

```
s3://<bucket>/<prefix>/
  raw/                    Shared source documents
  generated/<space>/      Shared AI-generated pages
  authored/<space>/       Shared human-authored pages
  _system/                Shared indexes, jobs, manifests, logs
  users/<user-id>/
    raw/
    generated/<space>/
    authored/<space>/
    _system/
  assets/                 Images and binary assets
```

Common commands:

```bash
pnpm dev
pnpm typecheck
pnpm build
pnpm ingest -- --help
```

## Deployment

Deployment configuration is intentionally kept out of this repo to support self-hosting and open source use. The app is a standard Next.js application — deploy to any platform that supports it.

**Vercel:** Connect the repo, set env vars in the dashboard, deploy. Zero config.

**Docker:** `docker build -t vaultmark web/` — pass env vars via `--env-file`.

Required environment variables are documented in `infra/.env.example`.

## Contributing

Read the PRD and ROADMAP before opening an issue or PR. The roadmap phases are the contract — deviations need a conversation.

## License

TBD.
