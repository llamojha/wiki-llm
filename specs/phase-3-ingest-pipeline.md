# Phase 3 — Ingest Pipeline

**Milestone:** MVP 1

## Goal

A TypeScript CLI and portal integration that transforms raw source documents into structured, indexed wiki pages via Bedrock. Organized by spaces (Confluence-style), with per-space indexing, upload from portal or CLI, and automatic ingest on arrival.

## Vision

Create a space (e.g., `engineering/`), drop a Markdown file into it, and structured wiki pages appear automatically — indexed per-space and browsable alongside authored content. No distinction in the tree between AI-generated and human-authored — just pages with a provenance badge.

## Content Model: Spaces

```
s3://<bucket>/<prefix>/
  index.md                         ← master index (all shared spaces)
  log.md                           ← global append-only log

  articles/                        ← shared space
    index.md                       ← space index (all pages in this space)
    raw/                           ← hidden, pending ingest/index
      my-draft.md
    deployment-guide.md            ← source_type: authored
    eks-overview.md                ← source_type: generated
    blue-green-deployment.md       ← source_type: generated

  engineering/                     ← shared space
    index.md
    raw/
      meeting-notes.md
    architecture.md                ← authored
    event-sourcing.md              ← generated

  personal/                        ← private space (access control in Phase 6)
    index.md
    notes/                         ← sub-space
      index.md
      raw/
        brain-dump.md
      my-notes.md                  ← authored
    ideas/
      index.md
      raw/
      brainstorm.md                ← authored
```

### Space Rules

- **Spaces are top-level folders** — each is an independent content domain
- **Each space has its own `raw/`** — hidden from portal, holds files pending ingest
- **Each space has its own `index.md`** — catalogs all navigable pages in that space
- **Sub-spaces are nested folders** with their own `raw/` and `index.md`
- **Master `index.md`** at root aggregates all shared spaces (excludes personal)
- **Generated and authored pages live side-by-side** — no separate `generated/` tree
- **Provenance is a file-level concern** — `source_type` frontmatter field, shown as badge
- **`raw/` is hidden everywhere** — per-space, never shown in portal sidebar

### Index Hierarchy

| Index | Scope | Contents |
|-------|-------|----------|
| Root `index.md` | All shared spaces | Aggregated listing of all shared space pages |
| `<space>/index.md` | Single space | All pages in that space (flat listing) |
| `personal/index.md` | Personal space | All personal sub-space pages |

### Provenance (frontmatter)

Every page has `source_type` in frontmatter:
- `authored` — human-written (via editor or uploaded without AI processing)
- `generated` — AI-produced by the ingest pipeline
- `uploaded` — uploaded by user, indexed but not AI-processed

The index doesn't distinguish between these. The portal shows a badge on individual files.

## Upload Paths

### Portal Upload

- Drag-and-drop zone or file picker in the web UI
- User selects target space (e.g., `articles/`)
- `POST /api/upload` — writes file to `<space>/raw/<filename>` in S3
- If auto-ingest enabled: immediately triggers ingest on the uploaded file
- If auto-ingest disabled: file sits in `<space>/raw/` until manually triggered

### CLI Upload

- `pnpm ingest add <file> --space <space>` — uploads to `<space>/raw/`, then ingests
- `pnpm ingest add <file> --space <space> --no-ingest` — upload only
- Supports multiple files: `pnpm ingest add *.md --space engineering`

### Direct S3 Upload

- Users can upload to `<space>/raw/` via AWS CLI or any S3 tool
- Picked up by `pnpm ingest run --space <space>` or portal manual trigger

## Ingest Trigger Modes

### Auto-Ingest (default: enabled)

- Controlled by `AUTO_INGEST=true|false` env var
- Portal exposes a toggle to enable/disable
- When enabled: upload → ingest runs immediately
- When disabled: uploads land in `raw/` without processing

### Manual Trigger (from portal)

- `POST /api/ingest` — triggers ingest on a specific file or all unprocessed files in a space
- UI button: "Process now" per file, or "Process all" per space

### CLI Trigger

- `pnpm ingest run --space <space>` — process all `raw/` files in a space
- `pnpm ingest run --space <space> <key>` — process specific file
- `pnpm ingest run` — process all `raw/` files across all spaces
- `pnpm ingest run --dry-run` — preview plan without writing

## Ingest Flow

```
1. File lands in <space>/raw/ (via portal, CLI, or direct S3)
2. If auto-ingest enabled → trigger immediately
3. Plan call: Bedrock reads raw doc + space index.md → structured JSON plan
   - Plan includes proposed path within the space for each output page
   - AI decides subfolder placement based on content analysis
4. Fan-out: parallel Bedrock calls generate each page (concurrency: 3)
5. Write generated pages into the space at AI-proposed paths
6. Regen <space>/index.md (all pages in space, excludes raw/)
7. Regen root index.md (aggregate all shared spaces)
8. Append to log.md
9. Portal sidebar refreshes → new pages visible with ✨ badge
```

### Plan Output Schema

```json
{
  "pages": [
    {
      "path": "people/john-doe.md",
      "type": "entity",
      "title": "John Doe",
      "description": "Key person mentioned in the source",
      "action": "create"
    },
    {
      "path": "architecture/event-sourcing.md",
      "type": "concept",
      "title": "Event Sourcing",
      "description": "Core architectural pattern discussed",
      "action": "update",
      "existingPath": "architecture/event-sourcing.md"
    }
  ]
}
```

### Output Placement

Ingest output goes **into the same space**, at paths proposed by the AI:
```
articles/raw/my-draft.md  →  ingest  →  articles/my-draft-summary.md
                                     →  articles/people/acme-corp.md
                                     →  articles/architecture/event-sourcing.md
```

## Portal Display

- Sidebar shows spaces as top-level folders
- Within each space: flat list of pages (no `raw/` visible, no `generated/` prefix)
- Badge per file: ✨ for `source_type: generated`, no badge for `authored`
- Unlisted pages (in S3 but not in index): • indicator
- `raw/` hidden at every level

## Key Decisions

- **Spaces model** — Confluence-style top-level folders, each self-contained with own index
- **Explicit space creation** — Spaces must be created via `pnpm ingest init --space <name>` (creates folder + `raw/` + `index.md`). Portal UX for space creation deferred to future.
- **AI-proposed placement** — Ingest plan call proposes output path (subfolder + filename) within the space. AI creates subfolders as needed based on content analysis.
- **`raw/` is a flat drop zone** — No structure required inside `raw/`. Users just drop files in.
- **Per-space indexes** — Each space maintains its own `index.md`
- **Master index** — Root `index.md` aggregates shared spaces only
- **Output into same space** — No global `generated/` tree; pages live where they belong, path decided by AI
- **Inline trigger** — Portal upload triggers ingest directly (no Lambda/SQS for MVP)
- **Auto-ingest toggle** — `AUTO_INGEST` env var (portal-configurable toggle deferred to future)
- **Fan-out with tool_use** — Plan call returns structured JSON, parallel generation calls
- **Personal space** — Just another space called `personal/` with different icon in sidebar. Access control deferred to Phase 6.
- **Migration** — Existing `wiki/` content will be migrated to fit the spaces model

## Acceptance Criteria

1. **Spaces:** Top-level folders act as spaces, each with own `raw/` and `index.md`.
2. **Portal upload:** File picker uploads to `<space>/raw/` via `POST /api/upload`.
3. **Auto-ingest:** With `AUTO_INGEST=true`, uploaded file is processed automatically. Pages appear in the same space.
4. **Auto-ingest toggle:** Portal toggle or env var disables auto-ingest.
5. **Manual trigger:** "Process now" button or `POST /api/ingest` triggers on demand.
6. **CLI add:** `pnpm ingest add <file> --space <space>` uploads and ingests.
7. **CLI run:** `pnpm ingest run --space <space>` processes all raw files in a space.
8. **Plan call:** Bedrock receives raw doc + space `index.md`, returns structured plan via tool_use.
9. **Fan-out:** Parallel generation (concurrency 3) produces pages with valid frontmatter.
10. **Output placement:** Generated pages written into the same space as the raw input.
11. **Per-space index:** `<space>/index.md` regenerated after each ingest run.
12. **Master index:** Root `index.md` regenerated (aggregates all shared spaces).
13. **Log:** `log.md` appended on every ingest. Auto-rotates at 100KB.
14. **Portal display:** Spaces as folders, `raw/` hidden, badges from frontmatter.
15. **Init:** `pnpm ingest init --space <space>` creates space with `raw/` and `index.md`.
16. **Lint:** `pnpm ingest lint --space <space>` validates pages in a space.
17. **End-to-end:** Upload → ingest → pages visible and searchable in portal.

## Out of Scope (this phase)

- Event-driven ingest: automatic processing when files land in S3 (Phase 6 — requires Lambda/SQS or background worker)
- Inline ingest from portal upload (upload returns immediately; user runs CLI to process)
- S3 Event Notifications / Lambda trigger (Phase 6 — SaaS)
- Personal space access control / multi-tenant isolation (Phase 6)
- Per-user personal space routing (`personal/<user-id>/`) (Phase 6)
- Portal UX for space creation (future — currently CLI-only via `pnpm ingest init --space`)
- Portal-configurable auto-ingest toggle (future — currently env var only)
- PDF/DOCX ingestion (future)
- Ingest queue / retry logic (future)
- Multi-file upload progress UI (single file at a time for MVP)
