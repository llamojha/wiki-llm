# legacy/ — archived `wiki-llm` implementation

This directory holds the original `wiki-llm` codebase from before the pivot to **Vaultmark** (see [`../prd_vaultmark_markdown_llm_wiki.md`](../prd_vaultmark_markdown_llm_wiki.md) and [`../CLAUDE.md`](../CLAUDE.md)).

It is **frozen reference**, not part of the active build. Nothing in `web/`, `api/`, or `infra/` should import from here.

## What's here

| Path | Purpose |
|---|---|
| `wiki.py` | CLI: Bedrock-powered ingest + lint of Markdown sources into a curated wiki |
| `raw/` | Drop zone for source documents (was: read-only inputs to `wiki.py`) |
| `wiki/` | Generated wiki output: `index.md`, `log.md`, plus `sources/`, `entities/`, `concepts/`, `analyses/` subtrees |
| `prompts/query.md` | Agent-neutral query prompt template |
| `.claude/commands/query.md` | `/query` slash command (deactivated by being under `legacy/`) |
| `AGENTS.md` | Old wiki-maintainer schema for non-Claude agents |
| `llm-wiki.md` | Original concept doc — the "why" behind wiki-llm |
| `TODO.md` | M1–M4 roadmap for wiki-llm (M3 Bedrock hardening was the last completed milestone) |
| `requirements.txt` | Python deps: `boto3` for Bedrock |

## Why it's preserved

Vaultmark needs a way to **generate or upload Markdown into the S3 vault**. The Bedrock pipeline here already does the "ingest a source → produce structured Markdown" half of that. When MVP 1's vault is real, `wiki.py` is the natural starting point for the `generated/` ingest worker (see PRD §11 S3 layout).

Until then: don't extend or refactor it. If you find yourself needing to revive it, do that as a deliberate phase — port it out of `legacy/` rather than reaching back in.

## How to revive (sketch)

1. Decide whether the worker runs as a CLI, a FastAPI background task, or a separate container.
2. Replace filesystem I/O (`raw/` and `wiki/` paths) with S3 reads/writes against the vault's `(bucket, prefix)`.
3. Output to `s3://<bucket>/<prefix>/generated/...` to keep generated content separate from user-authored pages.
4. Emit Postgres metadata rows so generated docs are searchable from day one.
5. Keep Bedrock as the LLM provider — model access and IAM notes are documented in the original `../README.md` (which itself still describes wiki-llm and needs a Vaultmark rewrite).

## Running the legacy code (if you really must)

```bash
cd legacy
pip install -r requirements.txt
python wiki.py --mock ingest raw/some-source.md   # offline smoke test
python wiki.py ingest raw/some-source.md          # live Bedrock
python wiki.py lint
```

Paths inside `wiki.py` are relative to its CWD, so run from `legacy/`.
