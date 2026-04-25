# TODO

## Bootstrap
- [x] Create CLAUDE.md schema
- [x] Create AGENTS.md (Codex / multi-agent compatibility)
- [x] Create directory structure (wiki/, raw/, raw/assets/)
- [x] Create wiki/index.md (empty catalog)
- [x] Create wiki/log.md (initial entry)
- [x] Create Claude Code slash commands: /ingest, /query, /lint
- [x] Add .gitignore
- [x] Add README.md
- [x] Add .editorconfig

## First Steps
- [ ] Drop your first source document into `raw/` and run `/ingest`
- [ ] Run `/lint` after a handful of sources to check wiki health
- [ ] Customise CLAUDE.md with domain-specific page types and tags
- [ ] Consider adding `qmd` (https://github.com/tobi/qmd) for search once wiki grows past ~50 pages

## Optional Enhancements
- [ ] Add Dataview frontmatter conventions to CLAUDE.md for Obsidian queries
- [ ] Add Marp slide conventions for presentation output
- [ ] Set up Obsidian Web Clipper for fast article ingest
- [ ] Configure Obsidian attachment folder to `raw/assets/` for local images
- [ ] Add `git commit` step to the ingest workflow in CLAUDE.md
