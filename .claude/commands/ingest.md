# /ingest — Ingest a New Source

Ingest a new source document into the wiki. Follow these steps in order:

1. **Read** the source file(s) provided by the human (or the most recent file added to `raw/`).
2. **Discuss** key takeaways — what's notable, surprising, or in tension with existing wiki content.
3. **Write** `wiki/sources/<slug>.md` — structured summary with YAML frontmatter (`title`, `type: source`, `tags`, `sources`, `created`, `updated`).
4. **Update** `wiki/index.md` — add the new source page to the Sources table.
5. **Update/create** entity pages in `wiki/entities/` for significant people, orgs, products.
6. **Update/create** concept pages in `wiki/concepts/` for key ideas and frameworks.
7. **Update** `wiki/overview.md` — revise the high-level synthesis to reflect what changed.
8. **Append** to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] ingest | <Source Title>
   Pages touched: sources/<slug>, entities/..., concepts/...
   Key additions/tensions: <brief note>
   ```
9. **Commit** with message: `ingest: <Source Title>`

If the human hasn't specified a file, ask: "Which file in `raw/` should I ingest?"
