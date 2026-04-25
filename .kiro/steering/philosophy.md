---
title: Vaultmark Development Philosophy
inclusion: always
---

# Vaultmark Development Philosophy

## Core Mission

Vaultmark makes Markdown in object storage the durable knowledge layer. The portal renders, searches, and lets a Bedrock-powered agent answer questions grounded in your own documents. Every design decision serves this: Markdown is the source of truth, S3 is the durable store, and the portal is the access layer.

## Design Principles

### Markdown First

- Markdown files in S3 are the canonical source of truth for all content.
- Postgres stores metadata and search indexes only — never authoritative content.
- When frontmatter and DB disagree, frontmatter wins; reindex.
- Document content must remain portable — no database lock-in.

### Minimal Scope

- Build only what the current phase requires. Phases are the contract.
- No feature creep beyond the active roadmap phase.
- Single-user, personal/OSS workflow first. SaaS concerns are deferred.
- YAGNI: don't build for anticipated future needs unless the current phase demands it.

### Pixel Parity During Port

- The `portal/` prototype is the design source of truth until the Next.js port is signed off.
- Visual output must be identical to the prototype. Only deviate where Next.js idioms force it.
- After parity sign-off, the prototype is deleted.

### User-Confirmed Writes

- No autonomous agent writes. Every content modification requires explicit user approval.
- The ask-wiki agent proposes; the user confirms.
- This is a hard constraint, not a preference.

### Reliability Over Cleverness

- Simple, direct solutions over clever abstractions.
- Graceful error handling — surface problems clearly, don't swallow them.
- Consistent behavior over feature richness.

## Technical Standards

### Security

- Sanitize all rendered Markdown (remark + rehype-sanitize). Never `dangerouslySetInnerHTML` raw user content.
- Environment-based configuration for all secrets and credentials.
- S3 access via least-privilege IAM policies.
- No mock fallbacks in production paths.

### Maintainability

- Server Components by default; Client Components only where interactivity demands it.
- Clear separation: frontend (web/) renders, backend (api/) serves data, S3 stores content.
- One vault, one bucket, one prefix — the `vault_id → (bucket, prefix)` mapping is the boundary.

### Incremental Delivery

- Each roadmap phase is independently deliverable and testable.
- Phase gates must be green before moving on.
- Vertical slices: implement end-to-end through all necessary layers before broadening.
