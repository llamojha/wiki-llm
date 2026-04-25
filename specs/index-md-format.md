# `index.md` Navigation Format

**Scope:** Phase 2+. This format is used by the API to build the vault navigation tree.

## Format

`index.md` lives at the vault root (`s3://<bucket>/<prefix>/index.md`). It is a Markdown file with YAML frontmatter and a flat list of relative S3 keys:

```markdown
---
title: Index
type: nav
updated: 2026-05-03
---

- wiki/getting-started.md
- wiki/architecture.md
- wiki/ops/runbook.md
- wiki/ops/alerts.md
- generated/deployment-process.md
```

## Rules

- Each list item is a path relative to the vault prefix (no leading slash, no `s3://` prefix).
- Indentation is not significant — folder grouping is derived from the path segments, not list nesting.
- Any S3 key under the vault prefix that is **not** listed in `index.md` is still accessible but appears in an "Unlisted" folder at the bottom of the tree.
- `index.md` itself is never listed as a navigable document.
- `log.md` is never listed as a navigable document.
- The API rebuilds the tree on every `GET /vaults/{id}/tree` call (with short-lived cache); `index.md` is the authoritative source.

## Tree derivation

Given the list above, the API produces:

```json
[
  {
    "id": "folder:wiki",
    "type": "folder",
    "name": "wiki",
    "children": [
      { "id": "wiki/getting-started.md", "type": "doc", "name": "Getting started" },
      { "id": "wiki/architecture.md", "type": "doc", "name": "Architecture" },
      {
        "id": "folder:wiki/ops",
        "type": "folder",
        "name": "ops",
        "children": [
          { "id": "wiki/ops/runbook.md", "type": "doc", "name": "Runbook" },
          { "id": "wiki/ops/alerts.md", "type": "doc", "name": "Alerts" }
        ]
      }
    ]
  },
  {
    "id": "folder:generated",
    "type": "folder",
    "name": "generated",
    "children": [
      { "id": "generated/deployment-process.md", "type": "doc", "name": "Deployment process" }
    ]
  }
]
```

Doc `name` is derived from the document's frontmatter `title` field; falls back to the filename stem (kebab-case → Title Case).

## Fallback (no `index.md`)

If `index.md` is absent or unparseable, the API falls back to listing all `.md` files under the vault prefix and grouping them by folder path. All docs appear as "listed" — there is no "Unlisted" group in fallback mode.

## Machine maintenance

Starting Phase 3, `index.md` is regenerated automatically on every ingest run and every user write/delete. In Phase 2, it must be created manually or seeded by the developer when connecting a vault.
