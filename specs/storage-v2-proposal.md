> **Status: proposal under review — not a decision.** External architecture suggestion (2026-07-03) for a v2 storage model. It is adjudicated in the folder-first design spike (see `plans/021-design-folder-first-vault-mode.md` and ROADMAP Track C): the advisor review recommends adopting its principles (metadata-driven provenance, derived views, events-as-truth, server-owned placement) while contesting ID-keyed filenames (portability) and resolving its conflict with folder-first mode, plus four gaps: user-scope layout, migration path, record/view concurrency, and scope creep (import/review-queue/PDF riders). The locked provenance-rooted layout in ROADMAP.md stands until that spec decides otherwise.

# Vaultmark Architecture

**WikiLLM pipeline + Confluence-style UX**

S3 stays operationally stable. The Vaultmark site shows spaces and page trees. AI proposes pages; the system validates, writes, indexes, and records provenance.

---

## 1. Core principle

```text
storage layout ≠ product structure ≠ provenance
```

Vaultmark should not expose backend implementation concepts as the user-facing information architecture.

The site should feel like Confluence:

```text
Spaces → Page tree → Pages → Labels → Search → Review queue
```

The backend should behave like WikiLLM:

```text
Raw sources → AI/user-created pages → indexes/logs/search/views
```

The S3 layout should stay operationally stable:

```text
stable object keys + metadata-driven navigation + derived views
```

### Do

- `raw/` is the source inbox.
- `pages/` is the canonical page store.
- `_system/` contains rules, jobs, records, indexes, views, and events.
- Use metadata for meaning.
- Use stable object keys for storage.
- Use derived views for navigation.

### Do not

- Do not expose `generated/` and `authored/` as user-facing structure.
- Do not make folder paths the source of truth.
- Do not let AI directly own the S3 structure.
- Do not make S3 look like Confluence.

---

## 2. S3 layout

Recommended layout:

```text
s3://bucket/vault/
  raw/
    src_01JABC/
      original.pdf
      meta.json

  pages/
    wiki/
      pg_01JAAA.md
      pg_01JAAB.md
    articles/
      pg_01JAAC.md
    personal/
      pg_01JAAD.md

  assets/
    pg_01JAAA/
      diagram.png
      attachment.pdf

  _system/
    structure.json

    page-records/
      pg_01JAAA.json
      pg_01JAAB.json

    jobs/
      curate_01.json

    processed/
      src_01JABC.json

    views/
      tree.wiki.json
      tree.articles.json
      search.json

    indexes/
      wiki.md
      articles.md
      index.md

    events/
      2026/07/03/evt_01.json
```

### Key decision

Pages are stored by stable page ID, not by visible tree path.

Use this:

```text
pages/wiki/pg_01JAAA.md
```

Not this:

```text
pages/wiki/platform/aws/lambda-curate-pipeline.md
```

Reason: page trees change. Users rename pages, AI places pages incorrectly, imports preserve old structures badly, and pages move between sections. Moving a page should update metadata, not require S3 copy/delete operations.

---

## 3. Storage concepts

### `raw/`

Source inbox for unprocessed material.

Examples:

- PDFs
- DOCX files
- transcripts
- meeting notes
- exported Confluence pages
- raw Markdown sources
- API-imported files

Files in `raw/` are not wiki pages. They are inputs for curation or import.

Example:

```text
raw/src_01JABC/original.pdf
raw/src_01JABC/meta.json
```

### `pages/`

Canonical page store.

Only valid Vaultmark pages live here.

Example:

```text
pages/wiki/pg_01JAAA.md
```

The path tells the system only this:

```text
this is a page in the wiki space
```

The visible tree, title, labels, status, and provenance come from metadata.

### `assets/`

Attachments belong to pages by page ID.

Example:

```text
assets/pg_01JAAA/diagram.png
assets/pg_01JAAA/attachment.pdf
```

This avoids breaking attachments when a page is renamed or moved.

### `_system/`

Operational backbone.

Contains:

- `structure.json`
- page records
- job records
- processed source records
- derived views
- generated Markdown indexes
- append-only events

Users should not navigate this directly in the Vaultmark site.

---

## 4. Metadata model

Vaultmark needs two metadata layers.

```text
frontmatter = user-facing page metadata
page record = system-owned provenance and operational metadata
```

### Page frontmatter

Stored inside the Markdown page.

Example:

```yaml
---
id: pg_01JAAA
title: "Lambda Curate Pipeline"
space: wiki
slug: lambda-curate-pipeline
parent_id: pg_platform
status: published
labels:
  - aws
  - lambda
  - vaultmark
---

# Lambda Curate Pipeline

Page body here.
```

This is portable and useful for Markdown workflows.

It controls page display metadata:

- title
- space
- slug
- parent
- status
- labels
- ordering
- summary

### Page record

Stored separately under `_system/page-records/`.

Example:

```json
{
  "id": "pg_01JAAA",
  "space": "wiki",
  "origin": "ai",
  "source_kind": "curate",
  "created_by_job": "curate_01",
  "source_refs": [
    "raw/src_01JABC/original.pdf"
  ],
  "created_at": "2026-07-03T19:00:00Z",
  "updated_at": "2026-07-03T19:12:00Z",
  "checksum": "abc123"
}
```

This is system-owned metadata.

It records:

- origin
- source kind
- source references
- job ID
- checksum
- creation/update timestamps
- import metadata
- audit-relevant operational data

The system should trust the page record more than frontmatter for provenance.

---

## 5. Provenance

Do not use folders like this:

```text
generated/wiki/foo.md
authored/wiki/bar.md
```

Use metadata instead.

Supported origins:

```text
origin: ai | human | import | system
```

Supported source kinds:

```text
source_kind: curate | manual_editor | markdown_upload | confluence_import | api | system_generated
```

Examples:

AI-curated page:

```json
{
  "origin": "ai",
  "source_kind": "curate",
  "created_by_job": "curate_01"
}
```

Human-created page:

```json
{
  "origin": "human",
  "source_kind": "manual_editor"
}
```

Imported Confluence page:

```json
{
  "origin": "import",
  "source_kind": "confluence_import"
}
```

The page appears in the same wiki tree regardless of origin.

The UI may show an origin badge:

```text
AI-generated from 3 sources
Human-authored
Imported from Confluence
System-generated index
```

But origin should not define navigation.

---

## 6. `structure.json`

`structure.json` defines allowed spaces and behavior.

It should not define every page.

Example:

```json
{
  "spaces": {
    "wiki": {
      "title": "Wiki",
      "indexed": true,
      "allow_ai": true,
      "default_parent_id": "pg_inbox",
      "allow_ai_new_sections": false
    },
    "articles": {
      "title": "Articles",
      "indexed": true,
      "allow_ai": false
    },
    "personal": {
      "title": "Personal",
      "indexed": false,
      "allow_ai": true,
      "scope": "user"
    }
  }
}
```

This controls:

- allowed spaces
- whether a space is indexed
- whether AI can create pages there
- default parent for uncertain placement
- whether AI can create new sections
- shared vs user scope

AI may create pages inside allowed spaces. AI must not create new top-level spaces unless explicitly allowed.

---

## 7. AI processing model

The AI should not write directly to S3.

The AI should propose pages.

The server validates and writes them.

```text
AI suggests placement.
The system owns placement.
```

### AI proposal shape

Example:

```json
{
  "title": "Lambda Curate Pipeline",
  "space": "wiki",
  "parent_hint": "Platform",
  "slug": "lambda-curate-pipeline",
  "labels": ["aws", "lambda", "vaultmark"],
  "body": "..."
}
```

### Server validation

Before writing, the server checks:

- Is the target space declared in `structure.json`?
- Is AI allowed in this space?
- Does the parent hint match an existing page?
- Is this a new page or an update to an existing page?
- Is the slug valid?
- Is there a collision?
- Should this be published or saved as draft?
- Are source references valid?

If placement is unclear:

```text
parent_id = pg_inbox
status = draft
```

This keeps the system useful without letting AI make permanent structural mess.

---

## 8. Processing flows

### Flow A: Add source

```text
User uploads source
→ raw/src_id/original
→ raw/src_id/meta.json
→ source appears in Source Inbox
→ curate job starts
→ AI proposes page(s)
→ server validates against structure.json
→ server writes pages/<space>/<pageId>.md
→ server writes _system/page-records/<pageId>.json
→ server rebuilds tree/search/indexes
→ server writes event
```

If the output is uncertain:

```text
put page under Inbox or mark as draft
```

### Flow B: Create page

```text
User writes in editor
→ server validates metadata
→ server creates page ID
→ server writes pages/<space>/<pageId>.md
→ server writes page record with origin=human
→ server rebuilds tree/search/indexes
→ server writes event
```

### Flow C: Upload Markdown page

```text
User uploads Markdown
→ server parses frontmatter
→ server validates or asks for missing metadata
→ server writes pages/<space>/<pageId>.md
→ server writes page record with origin=human and source_kind=markdown_upload
→ server rebuilds tree/search/indexes
→ server writes event
```

### Flow D: Import Confluence

```text
User imports Confluence export
→ importer maps spaces/pages/parents/labels
→ server creates stable page IDs
→ server writes pages/<space>/<pageId>.md
→ server writes page records with origin=import
→ server generates tree view
→ server rebuilds search/indexes
→ server writes events
```

---

## 9. Derived views

The Vaultmark site should not rebuild navigation by scanning paths on every request.

It should use derived views.

Example:

```text
_system/views/tree.wiki.json
_system/views/tree.articles.json
_system/views/search.json
```

### Tree view example

```json
{
  "space": "wiki",
  "title": "Wiki",
  "nodes": [
    {
      "id": "pg_inbox",
      "title": "Inbox",
      "children": []
    },
    {
      "id": "pg_platform",
      "title": "Platform",
      "children": [
        {
          "id": "pg_01JAAA",
          "title": "Lambda Curate Pipeline",
          "slug": "lambda-curate-pipeline",
          "origin": "ai",
          "status": "published"
        }
      ]
    }
  ]
}
```

### Indexing process

```text
read structure.json
scan pages/<space>/*.md
parse frontmatter
read matching page-record
validate page
filter by status
build tree from parent_id
build search from title/body/labels
write derived views
write Markdown indexes
```

Markdown indexes are useful for:

- WikiLLM context
- export
- human-readable summaries
- debugging
- offline review

JSON views are useful for:

- fast UI rendering
- navigation
- search
- filtering

---

## 10. Events and logs

Avoid treating `log.md` as the source of truth.

Appending to one S3 object is race-prone.

Use append-only event objects instead.

Example:

```text
_system/events/2026/07/03/evt_01.json
_system/events/2026/07/03/evt_02.json
```

Event example:

```json
{
  "id": "evt_01",
  "type": "page.created",
  "page_id": "pg_01JAAA",
  "origin": "ai",
  "job_id": "curate_01",
  "timestamp": "2026-07-03T19:12:00Z"
}
```

Then generate a readable log as a derived artifact:

```text
_system/log.md
```

Principle:

```text
events = truth
log.md = view
```

---

## 11. Vaultmark site UX

The site should show product concepts, not storage concepts.

Recommended navigation:

```text
Vaultmark
  Sources
    Pending
    Processed
    Failed

  Wiki
    Inbox
    Platform
      Lambda Curate Pipeline
    AWS
      Kiro Notes

  Articles
    How Vaultmark Works

  Personal
    Notes

  Review
    Drafts
    AI suggestions
    Conflicts
```

### Users should see

- spaces
- page tree
- search
- labels
- source references
- origin badge
- review queue
- drafts
- conflicts

### Users should not see

- `raw/`
- `generated/`
- `authored/`
- `_system/jobs/`
- internal indexes
- internal object keys

---

## 12. Page view UX

A page should show:

```text
Title
Body
Space
Parent
Labels
Status
Sources used
Origin badge
Last updated
Review state
```

Example:

```text
Lambda Curate Pipeline
Space: Wiki
Parent: Platform
Status: Published
Origin: AI-generated
Sources: aws-notes.pdf
Labels: aws, lambda, vaultmark
```

Origin is useful as context, not as structure.

---

## 13. Upload UX

Do not use one overloaded upload button.

Use three modes.

### Add source

For source material that should be processed or curated.

```text
PDF/doc/transcript/raw Markdown
→ raw/
→ optional AI curation
→ review or publish as page
```

### Create page

For direct authoring.

```text
Editor
→ pages/<space>/<pageId>.md
→ origin=human
→ visible page
```

### Import pages

For structured imports.

```text
Confluence/GitHub wiki/export
→ mapped into spaces/page tree/labels
→ pages/
→ origin=import
```

---

## 14. Final architecture decision

Use:

```text
raw/
  source inbox

pages/
  canonical page store

assets/
  page attachments

_system/
  operational backbone
```

Do not use:

```text
generated/
authored/
```

The final rule:

```text
S3 should not look like Confluence.
The site should look like Confluence.
The pipeline should behave like WikiLLM.
```

Final takeaway:

```text
Use metadata for meaning, stable object keys for storage, and derived views for navigation.
```
