# /query — Query the Wiki

Answer a question using the wiki. Follow these steps:

1. **Read** `wiki/index.md` to identify relevant pages (sources, entities, concepts, analyses).
2. **Read** the relevant pages. Follow cross-references (`[[links]]`) if they add context.
3. **Synthesize** an answer with citations — link to wiki pages and/or raw sources.
4. **Offer** to file the answer: "Should I save this as `wiki/analyses/<slug>.md`?"
   - If yes: write the analysis page with YAML frontmatter, update `wiki/index.md`.
5. **Append** to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] query | <Short Question Label>
   Pages consulted: ...
   Filed: wiki/analyses/<slug>.md  (or "not filed")
   ```

If the wiki is empty or the question is out of scope, say so clearly and suggest what sources to ingest first.
