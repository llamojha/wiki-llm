# Phase 3 — Ingest Pipeline

**Milestone:** MVP 1

## Goal

A TypeScript CLI that transforms raw source documents into structured, indexed wiki pages via Bedrock. Builds the S3 write infrastructure that Phase 4 extends.

## Vision

Drop a Markdown file into `raw/`, run `pnpm ingest`, and see polished structured pages appear in `generated/` — indexed and browsable in the portal alongside any existing content.

## Objective

Port the Bedrock-powered ingest logic from `legacy/wiki.py` into a TypeScript CLI package (`ingest/`) in the pnpm workspace. Implement S3 writes, `index.md` regeneration, `log.md` appending, and AI context file creation.

## Architecture

```
wiki-llm/
├── web/           Next.js portal (reads from S3)
├── ingest/        TypeScript CLI (writes to S3)
│   ├── src/
│   │   ├── cli.ts          Entry point
│   │   ├── transform.ts    Bedrock-powered doc transformation
│   │   ├── index-gen.ts    index.md regeneration
│   │   └── log.ts          log.md appending
│   ├── package.json
│   └── tsconfig.json
└── ...
```

The `ingest/` package shares `@aws-sdk/client-s3` and `@aws-sdk/client-bedrock-runtime` with `web/`. It runs locally or in CI — not as a web service.

## Key Decisions

- **TypeScript CLI, not a container** — runs via `pnpm ingest`, no Docker required.
- **Shared AWS SDK** — same S3 client pattern as `web/lib/s3.ts`.
- **Batch index regen** — `index.md` regenerates once at the end of each ingest run, not per-page.
- **Flat `index.md`** — single root file listing all navigable docs. Per-folder indexes deferred until vault exceeds ~500 docs.
- **AI context files** — created on vault init if they don't exist.
- **`log.md` is the app logger** — records all writes and ingest runs. Auto-rotates at size threshold.

## Acceptance Criteria

1. `pnpm ingest <s3-key-or-glob>` reads source docs from `raw/` and writes structured output to `generated/` with `source_type = generated` frontmatter.
2. Bedrock invoke uses `@aws-sdk/client-bedrock-runtime` targeting `amazon.nova-2-lite-v1:0`; model ID configurable via env var.
3. `index.md` is regenerated (flat list of all `.md` files except itself and `log.md`) after each ingest run.
4. `log.md` is appended on every ingest run. Auto-rotates when it exceeds 100KB.
5. `pnpm ingest --init` creates AI context files (`AGENTS.md`, `WIKI_RULES.md`, `SOURCES.md`, `TASKS.md`) if they don't exist.
6. `pnpm ingest --lint` validates generated output structure and frontmatter.
7. End-to-end: place a file in `raw/`, run ingest, verify pages in `generated/` are visible and searchable in the portal.
8. No Docker required — runs with Node.js 22+ and AWS credentials.
9. Shares env vars with `web/` (`VAULT_BUCKET`, `VAULT_PREFIX`, `VAULT_REGION`).
