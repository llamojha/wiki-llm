# TODO

## Bootstrap
- [x] Create CLAUDE.md schema
- [x] Create AGENTS.md (multi-agent compatibility)
- [x] Create directory structure (wiki/, raw/, raw/assets/)
- [x] Create wiki/index.md (empty catalog)
- [x] Create wiki/log.md (initial entry)
- [x] Add .gitignore, README.md, .editorconfig
- [x] Add wiki.py — Bedrock-powered ingest and lint (Amazon Nova Lite)
- [x] Add prompts/query.md — agent-neutral query prompt
- [x] Keep /query as Claude Code slash command

## First Steps
- [ ] Drop your first source document into `raw/` and run `python wiki.py ingest`
- [ ] Run `python wiki.py lint` after a handful of sources to check wiki health
- [ ] Customise CLAUDE.md with domain-specific page types and tags
- [ ] Set AWS_REGION if not using us-east-1

## Optional Enhancements
- [ ] Add Dataview frontmatter conventions to CLAUDE.md for Obsidian queries
- [ ] Add Marp slide conventions for presentation output
- [ ] Set up Obsidian Web Clipper for fast article ingest
- [ ] Configure Obsidian attachment folder to `raw/assets/` for local images
