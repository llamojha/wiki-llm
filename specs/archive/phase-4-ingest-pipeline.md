# Phase 4 — Ingest Pipeline

## Goal

Revive the legacy `wiki.py` as a containerized worker that transforms raw source documents into structured, indexed pages in the vault.

## Vision

Drop a Markdown file into `raw/`, run the ingest command, and see polished structured pages appear in `generated/` — indexed and browsable in the portal alongside user-authored content.

## Objective

Port the Bedrock-powered ingest logic from `legacy/wiki.py` into a standalone worker with S3 I/O, a CLI entrypoint, and Docker Compose integration.

## Acceptance Criteria

1. A `worker/` (or `api/workers/`) container runs the ingest pipeline, invocable via `vaultmark ingest <s3-key>`.
2. The worker reads source documents from `raw/` in S3 and writes structured output to `generated/` with `source_type = generated` metadata.
3. All filesystem I/O from `legacy/wiki.py` is replaced with S3 reads/writes against the configured vault.
4. `index.md` is updated after each ingest run to include newly generated pages.
5. The Bedrock model is pinned to `amazon.nova-2-lite-v1:0` with the model ID configurable via environment variable.
6. `vaultmark lint` validates generated output structure and frontmatter.
7. A Dockerfile and `docker-compose.yml` service entry exist for the worker.
8. End-to-end test: place a file in `raw/`, run ingest, verify pages in `generated/` are visible and searchable in the portal.
