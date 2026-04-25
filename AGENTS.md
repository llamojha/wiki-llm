# Wiki LLM — Schema & Operating Instructions

This file mirrors CLAUDE.md for use with OpenAI Codex, Pi (OpenCode), and other agents.
See CLAUDE.md for the full schema. All conventions, directory layout, and workflows are identical.

## Quick Reference

- Raw sources: `raw/` — read only, never modify
- Wiki pages: `wiki/` — you own this entirely
- Index: `wiki/index.md` — update on every ingest
- Log: `wiki/log.md` — append-only, `## [YYYY-MM-DD] <type> | <label>`

## Operations

- **Ingest**: read source → discuss → write summary → update index, entities, concepts, overview, log
- **Query**: read index → read pages → synthesize → optionally file answer → update log
- **Lint**: scan for contradictions, orphans, gaps → propose fixes → update log

See CLAUDE.md for the full field guide.
