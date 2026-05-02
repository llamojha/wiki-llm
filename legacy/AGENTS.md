# Wiki LLM — Schema & Operating Instructions

This file is for use with OpenAI Codex, Kiro, Pi (OpenCode), and other agents.
See CLAUDE.md for the full schema. All conventions and directory layout are identical.

## Quick Reference

- Raw sources: `raw/` — read only, never modify
- Wiki pages: `wiki/` — you own this entirely
- Index: `wiki/index.md` — update after every query that files an answer
- Log: `wiki/log.md` — append-only, `## [YYYY-MM-DD] <type> | <label>`

## Operations

### Ingest & Lint → `wiki.py` (Bedrock)

These are handled by `wiki.py`, not by the agent:

```bash
python wiki.py ingest raw/my-source.md   # process a new source
python wiki.py lint                       # audit the wiki
```

### Query → agent (you)

When the human asks a question, follow `prompts/query.md`:

1. Read `wiki/index.md` to identify relevant pages
2. Read the relevant pages; follow `[[wikilinks]]` if needed
3. Synthesize an answer with citations
4. Offer to file as `wiki/analyses/<slug>.md` if non-trivial
5. Append to `wiki/log.md`

See CLAUDE.md for the full field guide.
