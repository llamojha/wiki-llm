# PRD.md — Vaultmark

## 1. Executive Summary

Vaultmark is an S3-backed Markdown knowledge portal for individuals and engineering teams.

It provides a browser-accessible Markdown vault where documentation, personal notes, generated knowledge, and pipeline-produced Markdown can be stored, rendered, searched, and eventually maintained by AI agents.

The first version focuses on a personal/open-source workflow: a user connects an S3 bucket, stores Markdown as the source of truth, renders it as a wiki, searches it, and maintains a private personal knowledge base. The SaaS version extends this into authenticated team workspaces, shared documentation, private user wikis, and a chat assistant over indexed content.

## 2. Problem Statement

Engineering knowledge is scattered across static docs, personal notes, generated artifacts, chat threads, runbooks, and pipeline outputs.

Existing options are flawed:

- Static site generators require rebuilds.
- Confluence-style tools are heavy and proprietary.
- Obsidian is excellent locally but not cloud-native by default.
- RAG systems often retrieve fragments without maintaining durable structured knowledge.
- AI-generated knowledge often disappears into chat history instead of becoming reusable documentation.

Vaultmark solves this by making Markdown in object storage the durable knowledge layer.

## 3. Target Users

### Primary users

- Engineers maintaining personal technical notes.
- DevOps/SRE/platform engineers with runbooks and operational docs.
- Developers generating Markdown artifacts from AI or automation.
- Technical founders building lightweight internal knowledge systems.

### Future SaaS users

- Platform teams.
- DevTool companies.
- Engineering consultancies.
- Enterprise teams needing authenticated internal knowledge portals.

## 4. Goals

### Product goals

- Provide an S3-backed Markdown vault.
- Render Markdown as a runtime wiki.
- Support private user-owned knowledge spaces.
- Index documents for fast search.
- Preserve a structure suitable for future AI agents.
- Support a future team/SaaS version with authentication and shared workspaces.

### Technical goals

- Keep Markdown as the source of truth.
- Avoid database lock-in for document content.
- Use object storage for portability and durability.
- Support simple local/self-hosted deployment first.
- Keep the system compatible with EKS deployment later.
- Make the indexing and rendering pipeline inspectable.

## 5. Non-Goals

### MVP 1 non-goals

- No collaborative editing.
- No real-time editing.
- No complex permissions.
- No billing.
- No full RAG pipeline.
- No vector database.
- No PDF/DOCX ingestion.
- No enterprise admin console.
- No public publishing workflow.

### MVP 2 non-goals

- No autonomous agent editing without user approval.
- No complex workflow approvals.
- No full Confluence replacement.

## 6. Product Scope

## Demo Scope

The demo proves the core loop:

```text
Markdown in S3 → runtime wiki rendering → search → personal wiki page → simple chat preview
```

Demo capabilities:

- Configure S3 bucket/prefix.
- List Markdown files.
- Render Markdown as HTML.
- Navigate pages.
- Search document titles/body.
- Create a personal Markdown page.
- Store the page back into S3.

## MVP 1 Scope

MVP 1 is a usable personal/open-source product.

Required capabilities:

- S3-backed Markdown vault.
- Runtime Markdown rendering.
- Markdown sanitization.
- Navigation tree.
- Search indexing.
- Personal wiki CRUD.
- Basic document metadata.
- Local Docker Compose deployment.
- Optional EKS deployment manifests.

## MVP 2 Scope

MVP 2 adds controlled AI interaction.

Required capabilities:

- Chat interface.
- Search-backed context retrieval.
- Source links in answers.
- User-selected scope: all docs, selected folder, selected page.
- Refusal when indexed content does not support an answer.
- Basic usage logging.

## Future SaaS Scope

Future hosted version:

- User accounts.
- Team workspaces.
- Keycloak/OIDC/SAML support.
- Shared team wiki.
- Private user wiki.
- Pipeline-fed Markdown ingestion.
- Admin dashboard.
- Billing.
- Audit logs.
- Tenant isolation.

## 7. User Stories

### Personal user

- As a user, I want to connect an S3 bucket so my Markdown vault is stored in cloud object storage.
- As a user, I want to browse Markdown as a wiki so I can read my notes in a clean portal.
- As a user, I want to create and edit Markdown pages so I can maintain my own wiki.
- As a user, I want search so I can find old notes quickly.
- As a user, I want generated or imported docs to become durable Markdown files, not temporary chat output.

### Engineering team user

- As an engineer, I want pipeline-generated Markdown to appear in the portal without a rebuild.
- As a platform engineer, I want runbooks and architecture docs searchable from one place.
- As an admin, I want access control so private/team docs do not leak.
- As a future user, I want to ask questions over indexed docs and get source links.

## 8. Functional Requirements

## FR1 — S3 Vault Connection

The system must support storing and reading Markdown files from S3-compatible object storage.

Minimum fields:

- bucket
- region
- prefix
- access method
- user vault path

## FR2 — Markdown Runtime Renderer

The system must render Markdown into safe HTML at request time.

Must support:

- headings
- links
- images
- fenced code blocks
- tables
- frontmatter
- heading anchors

Must sanitize unsafe HTML.

## FR3 — Navigation

The system must generate navigation from the vault structure.

Navigation sources:

- folder hierarchy
- `index.md`
- frontmatter title
- file name fallback

## FR4 — Personal Wiki CRUD

The system must allow users to:

- create Markdown pages
- edit Markdown pages
- delete Markdown pages
- rename/move pages, optional after MVP 1

## FR5 — Search

The system must index Markdown files and support search.

Search result must include:

- title
- snippet
- path
- updated timestamp
- source type

Search scopes:

- all vault docs
- personal wiki
- selected folder

## FR6 — Metadata

The system must store metadata for each document.

Metadata includes:

- document ID
- S3 key
- slug
- title
- source type
- checksum
- tags
- created timestamp
- updated timestamp
- indexing status

## FR7 — Chat Assistant, MVP 2

The chat assistant must answer using indexed content only.

Required behavior:

- query the search index
- use top matching documents as context
- show source links
- refuse unsupported answers
- respect selected scope

## 9. Technical Requirements

## Recommended demo/MVP stack

- Frontend: Next.js
- Backend: FastAPI
- Storage: S3 or S3-compatible storage
- Metadata DB: Postgres or SQLite for local mode
- Search: Postgres full-text search for MVP 1
- Runtime: Docker Compose for local/open-source
- Optional deployment: EKS manifests

## Future SaaS stack

- Frontend: Next.js
- Backend: FastAPI
- Auth: Keycloak/OIDC
- Storage: S3
- Metadata: RDS Postgres
- Search: OpenSearch or Meilisearch
- Workers: Kubernetes workers / SQS consumers
- Runtime: EKS

## 10. Data Model

### Document

```text
id
vault_id
owner_user_id
source_type
s3_key
slug
title
tags
checksum
created_at
updated_at
indexed_at
index_status
```

### Vault

```text
id
owner_user_id
name
bucket
prefix
region
created_at
updated_at
```

### SearchRecord

```text
document_id
title
body
headings
tags
path
source_type
updated_at
```

### ChatSession, MVP 2

```text
id
user_id
scope
created_at
updated_at
```

### ChatMessage, MVP 2

```text
id
session_id
role
content
source_documents
created_at
```

## 11. S3 Layout

Personal/open-source layout:

```text
s3://bucket/
  vault/
    index.md
    log.md
    wiki/
      concepts/
      projects/
      notes/
      runbooks/
    raw/
      sources/
    generated/
    assets/
```

Future SaaS layout:

```text
s3://bucket/
  tenants/
    tenant-a/
      shared/
      users/
        user-123/
          wiki/
      assets/
```

## 12. AI Context Structure

The vault should include Markdown files that guide future agents:

```text
AGENTS.md
WIKI_RULES.md
INDEX.md
LOG.md
SOURCES.md
TASKS.md
```

Purpose:

- `AGENTS.md` defines how agents should maintain the vault.
- `WIKI_RULES.md` defines structure and linking conventions.
- `INDEX.md` acts as the main catalog.
- `LOG.md` records important updates.
- `SOURCES.md` records external/source material.
- `TASKS.md` tracks pending maintenance work.

## 13. Milestones

## Demo

Acceptance criteria:

- User can point the app at an S3 bucket/prefix.
- App lists Markdown files.
- App renders selected Markdown page.
- App searches indexed Markdown.
- User creates one personal wiki page.

## MVP 1

Acceptance criteria:

- User has a stable personal S3-backed Markdown vault.
- User can browse, create, edit, delete, and search Markdown pages.
- Rendering is sanitized.
- Indexing can be refreshed reliably.
- App can run locally through Docker Compose.
- App has clear setup documentation.

## MVP 2

Acceptance criteria:

- User can ask a question over selected indexed docs.
- Chat response includes source links.
- Chat refuses unsupported answers.
- Chat does not modify Markdown without explicit user action.

## 14. Success Metrics

## Demo metrics

- Time to connect a vault: under 10 minutes.
- Time from Markdown added to searchable: under 60 seconds in demo mode.
- Search returns expected page in top 5 results for known terms.

## MVP 1 metrics

- User can maintain at least 100 Markdown pages comfortably.
- Page render latency under 500ms for cached pages.
- Search latency under 1 second for small vaults.
- Zero known unsafe HTML rendering paths.

## MVP 2 metrics

- Chat answers include at least one source link when answering from docs.
- Chat refuses when no relevant docs are found.
- User can trace answer back to source Markdown.

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Scope creep into full wiki platform | High | Keep MVP personal and Markdown-first |
| Agent corrupts wiki structure | High | Require explicit user approval for writes |
| S3 write conflicts | Medium | Use checksums and optimistic locking |
| Search quality is weak | Medium | Start with Postgres FTS, tune ranking later |
| Unsafe Markdown rendering | High | Sanitize HTML and restrict allowed tags |
| Too SaaS too early | High | Validate open-source/personal workflow first |
| Chat hallucination | High | Source links and refusal behavior |

## 16. Open Questions

- Should the first version require AWS S3, or support MinIO/R2 from day one?
- Should editing happen in-browser only, or also via local folder sync?
- Should `index.md` and `log.md` be mandatory?
- Should generated documents be stored separately from user-authored documents?
- Should the open-source version include auth, or keep it single-user?
- What is the minimum useful chat behavior for MVP 2?

## 17. Recommendation

Build the personal/open-source version first.

Position it as:

> Vaultmark — an S3-backed Markdown vault for people, pipelines, and agents.

Then evolve it into the SaaS product once the core vault, rendering, search, and agent-maintained wiki loop are proven.

