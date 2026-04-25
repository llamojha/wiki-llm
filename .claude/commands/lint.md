# /lint — Health-Check the Wiki

Audit the wiki for quality issues. Work through each check:

1. **Contradictions** — find claims across pages that conflict. List them with page refs.
2. **Orphan pages** — find pages with no inbound `[[links]]` from other wiki pages.
3. **Missing concept pages** — find terms used frequently but lacking their own `wiki/concepts/` page.
4. **Stale claims** — find assertions that newer ingested sources have updated or superseded.
5. **Data gaps** — identify questions the wiki can't yet answer; suggest sources or web searches.
6. **Cross-reference gaps** — find entity/concept names mentioned but not linked.

Produce a **lint report** as a numbered list of issues with severity (low / medium / high).
Ask the human which fixes to apply. Apply approved fixes, then:

7. **Append** to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] lint
   Issues found: N  |  Fixed: M
   Summary: <brief note>
   ```
8. **Commit** with message: `lint: <brief summary>`
