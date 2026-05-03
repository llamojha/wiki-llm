# Phase 3 — Ingest Pipeline

**Milestone:** MVP 1

## Goal

Revive the legacy `wiki.py` as a containerized worker that transforms raw source documents into structured, indexed pages in the vault. This phase also builds the S3 write infrastructure that Phase 4 will extend.

## Vision

Drop a Markdown file into `raw/`, run the ingest command, and see polished structured pages appear in `generated/` — indexed and browsable in the portal alongside any existing content.

## Objective

Port the Bedrock-powered ingest logic from `legacy/wiki.py` into a standalone worker with S3 I/O, build the foundational write layer (S3 PutObject + index regeneration), create the AI context files, and implement `log.md` as the app-level activity logger.

## Key Decisions

- **Write infrastructure lives here** — S3 write (PutObject), `index.md` regeneration, and `log.md` appending are built in this phase. Phase 4 adds optimistic concurrency and the user-facing Editor on top.
- **Batch index regen** — `index.md` regenerates once at the end of each ingest run, not per-page.
- **Hierarchical `index.md`** — designed from the start as root `index.md` + per-folder `index.md` files to handle vault growth.
- **AI context files** — `AGENTS.md`, `WIKI_RULES.md`, `SOURCES.md`, `TASKS.md` are created alongside `index.md` and `log.md` as part of vault initialization.
- **`log.md` is the app logger** — records all writes, ingest runs, agent proposals (accepted/rejected), and index rebuilds. Auto-rotates at a size threshold (e.g., archive to `log-2026-04.md`).

## Acceptance Criteria

1. A `worker/` (or `api/workers/`) container runs the ingest pipeline, invocable via `vaultmark ingest <s3-key>`.
2. The worker reads source documents from `raw/` in S3 and writes structured output to `generated/` with `source_type = generated` metadata.
3. All filesystem I/O from `legacy/wiki.py` is replaced with S3 reads/writes against the configured vault.
4. `index.md` (root + per-folder) is regenerated once at the end of each ingest run.
5. AI context files (`AGENTS.md`, `WIKI_RULES.md`, `SOURCES.md`, `TASKS.md`) are created on vault initialization if they don't exist.
6. `log.md` is appended on every ingest run, write operation, and index rebuild. Auto-rotates when it exceeds the size threshold.
7. The Bedrock model is pinned to `amazon.nova-2-lite-v1:0` with the model ID configurable via environment variable.
8. `vaultmark lint` validates generated output structure and frontmatter.
9. A Dockerfile and `docker-compose.yml` service entry exist for the worker.
10. End-to-end test: place a file in `raw/`, run ingest, verify pages in `generated/` are visible and searchable in the portal.
11. Time from Markdown added to searchable: under 60 seconds.
