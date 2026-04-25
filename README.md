# wiki-llm

A personal knowledge base maintained by LLMs. You curate sources and ask questions; the LLM does the summarising, cross-referencing, and bookkeeping.

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

Heavy operations (ingest, lint) run via Amazon Bedrock. Queries are handled interactively by whichever AI agent you're using.

## Setup

```bash
pip install -r requirements.txt
```

AWS credentials must be configured (`~/.aws/credentials`, environment variables, or IAM role). The model defaults to `amazon.nova-lite-v2:0` and region to `us-east-1` — override with `WIKI_MODEL` and `AWS_REGION` env vars.

## Usage

### Ingest a source

Drop a document into `raw/`, then:

```bash
python wiki.py ingest raw/my-article.md
```

`wiki.py` calls Bedrock, writes all wiki pages (source summary, entities, concepts, index, overview, log), and commits.

### Lint the wiki

```bash
python wiki.py lint
```

Scans all wiki pages for contradictions, orphans, stale claims, and gaps. Prints a report and asks before applying fixes.

### Query

Use any AI agent with `prompts/query.md` as a prompt template. The agent reads the wiki and synthesizes an answer.

| Agent | How to query |
|-------|-------------|
| Claude Code | `/query` slash command |
| Codex / Kiro / other | paste or reference `prompts/query.md` |

## Schema

[`CLAUDE.md`](CLAUDE.md) — full operating instructions (Claude Code).
[`AGENTS.md`](AGENTS.md) — same for other agents.
[`prompts/query.md`](prompts/query.md) — agent-neutral query prompt.

## Tips

- **Obsidian Web Clipper** converts web articles to markdown for fast ingest.
- **Graph view** in Obsidian shows the shape of your wiki — hubs, orphans, clusters.
- Run `python wiki.py lint` after every ~10 ingests to keep the wiki healthy.
