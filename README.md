# wiki-llm

A personal knowledge base maintained by an LLM. You curate sources and ask questions; the LLM does the summarising, cross-referencing, and bookkeeping.

Read [`llm-wiki.md`](llm-wiki.md) for the full concept.

## How it works

```
raw/          ← you drop source documents here (immutable)
wiki/         ← LLM writes and maintains all of this
  index.md    ← catalog of every page
  log.md      ← append-only history of ingests, queries, lint passes
  sources/    ← one summary per raw source
  entities/   ← people, orgs, products
  concepts/   ← ideas, terms, frameworks
  analyses/   ← filed answers to non-trivial queries
```

The LLM builds the wiki incrementally — each new source is integrated into existing pages, contradictions are flagged, cross-references are maintained. Knowledge compounds instead of being re-derived on every question.

## Setup

1. Clone the repo and open it in [Obsidian](https://obsidian.md) (optional but recommended for graph view and Dataview).
2. Open the project in [Claude Code](https://claude.ai/code).
3. Drop a source document into `raw/` and run `/ingest`.

## Slash commands (Claude Code)

| Command | What it does |
|---------|-------------|
| `/ingest` | Process a new source into the wiki |
| `/query`  | Answer a question from the wiki; optionally file the answer |
| `/lint`   | Audit the wiki for contradictions, orphans, and gaps |

## Schema

[`CLAUDE.md`](CLAUDE.md) — full operating instructions for Claude Code.
[`AGENTS.md`](AGENTS.md) — same schema for Codex / other agents.

## Tips

- **Obsidian Web Clipper** converts web articles to markdown for fast ingest.
- **Graph view** in Obsidian shows the shape of your wiki — hubs, orphans, clusters.
- Run `/lint` after every ~10 ingests to keep the wiki healthy.
- For large wikis (50+ pages), consider adding [`qmd`](https://github.com/tobi/qmd) for hybrid BM25/vector search.
