# Wiki LLM — Schema & Operating Instructions

This is a persistent, LLM-maintained knowledge base. You are the wiki maintainer.
You read and write the wiki; the human curates sources and asks questions.

## Directory Layout

```
wiki-llm/
├── CLAUDE.md          ← this file (schema + instructions)
├── AGENTS.md          ← same schema, for non-Claude agents
├── TODO.md            ← task tracking
├── raw/               ← immutable source documents (you read, never modify)
│   └── assets/        ← locally downloaded images
└── wiki/              ← LLM-generated markdown (you own this entirely)
    ├── index.md       ← content catalog, updated on every ingest
    ├── log.md         ← append-only chronological record
    ├── overview.md    ← high-level synthesis of the whole wiki
    ├── sources/       ← one summary page per raw source
    ├── entities/      ← people, organisations, projects, products
    ├── concepts/      ← ideas, terms, frameworks, methods
    └── analyses/      ← comparisons, deep-dives, query answers worth keeping
```

## Page Frontmatter (YAML)

Every wiki page should begin with YAML frontmatter:

```yaml
---
title: "Page Title"
type: source | entity | concept | analysis | overview
tags: [tag1, tag2]
sources: [filename1.md, filename2.pdf]   # raw sources this page draws from
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Linking Conventions

- Link liberally between pages: `[[Page Title]]` (Obsidian-style wikilinks).
- Every entity or concept that appears in a page and has its own page should be linked on first mention.
- Orphan pages (no inbound links) are a wiki smell — fix them during lint.

## Operations

### Ingest (`python wiki.py ingest <file>`)

Run via Bedrock — not handled interactively by the agent.

```bash
python wiki.py ingest raw/my-source.md
```

`wiki.py` reads the source, writes all wiki pages, and commits. No agent involvement needed.

### Query (`/query` or `prompts/query.md`)

When the human asks a question:

1. Read `wiki/index.md` to find relevant pages.
2. Read the relevant pages. Follow cross-references if needed.
3. Synthesize an answer with citations (link to wiki pages and/or raw sources).
4. Offer to file the answer as a new `wiki/analyses/` page if it's non-trivial.
5. Append to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] query | <Short Question Label>
   Brief note: what was asked, what pages were consulted, what was filed.
   ```

The query prompt lives at `prompts/query.md` and works with any agent (Claude Code, Codex, Kiro, etc.). Claude Code users can also use `/query` as a slash command.

### Lint (`python wiki.py lint`)

Run via Bedrock — not handled interactively by the agent.

```bash
python wiki.py lint
```

`wiki.py` scans all wiki pages, prints a lint report, and applies approved fixes.

## Index Format (`wiki/index.md`)

```markdown
# Wiki Index

## Sources
| Page | Summary | Date | Sources |
|------|---------|------|---------|
| [[sources/slug]] | One-line summary | YYYY-MM-DD | filename.md |

## Entities
| Page | Type | Summary |
|------|------|---------|
| [[entities/name]] | person/org/product | One-liner |

## Concepts
| Page | Summary |
|------|---------|
| [[concepts/name]] | One-liner |

## Analyses
| Page | Question | Date |
|------|----------|------|
| [[analyses/slug]] | What was asked | YYYY-MM-DD |
```

## Log Format (`wiki/log.md`)

Append-only. Most recent entry at the bottom. Header format:
`## [YYYY-MM-DD] <type> | <label>`

Types: `ingest`, `query`, `lint`, `setup`.

Parse with: `grep "^## \[" wiki/log.md | tail -10`

## Quality Rules

- **Never modify files under `raw/`.**
- **Always update `wiki/index.md` and `wiki/log.md`** after any ingest, query (if filing), or lint.
- Prefer updating existing pages over creating new ones for the same concept.
- Flag contradictions explicitly rather than silently overwriting old claims.
- Keep pages focused — split if a page becomes hard to navigate.
- The wiki is a git repo — commit after meaningful units of work so history is useful.

## Evolving This Schema

This file is co-owned by you and the human. As the domain becomes clearer, update it:
- Add domain-specific page types.
- Add tagging taxonomies.
- Add conventions for output formats (Marp slides, Dataview tables, matplotlib charts).
- Document any custom CLI tools added (e.g. search via qmd).

Update the version comment at the top of this file when you make schema changes.
