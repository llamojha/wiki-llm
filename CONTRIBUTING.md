# Contributing to Vaultmark

Thanks for your interest in Vaultmark — an S3-backed Markdown knowledge portal.

## Before you start

Read these in order; they explain what the project is and where it's going:

1. [`README.md`](README.md) — what Vaultmark does and how to run it
2. [`prd_vaultmark_markdown_llm_wiki.md`](prd_vaultmark_markdown_llm_wiki.md) — product spec
3. [`ROADMAP.md`](ROADMAP.md) — engineering plan. **The roadmap phases are the contract** — features outside the active phase need a conversation (open an issue) before a PR.

## Development setup

Prerequisites: Node.js 22+, pnpm 10+, and AWS credentials with access to an S3 bucket (any bucket you own works for development).

```bash
pnpm install

# Configure your vault
cp infra/.env.example web/.env.local
# edit web/.env.local — set VAULT_BUCKET / VAULT_PREFIX / VAULT_REGION

pnpm dev          # Next.js dev server on http://localhost:3000
```

All configuration is documented in [`docs/configuration.md`](docs/configuration.md).

## Quality gates

CI runs these on every PR; run them locally before pushing:

```bash
pnpm typecheck    # web — TypeScript strict mode, no errors
pnpm build        # web — production build must succeed

# Curate Lambda (only if you touched infra/lambda/curate/)
cd infra/lambda/curate && npm test && npx tsc --noEmit
```

## Conventions

- **TypeScript strict mode.** No `any` without justification.
- **Server Components by default.** `'use client'` only where interactivity demands it.
- **Plain CSS.** No Tailwind, no UI component libraries.
- **Sanitize all rendered Markdown.** remark + rehype-sanitize; never `dangerouslySetInnerHTML` with raw user content.
- **Markdown in S3 is the source of truth.** Indexes and metadata stores are never authoritative.
- **User-confirmed writes.** The ask-wiki agent proposes; the user confirms. No autonomous content writes — this is a hard constraint.
- **No secrets in the repo.** Configuration via environment variables only. Never commit account IDs, bucket names tied to a person, or credentials.
- File names kebab-case; components PascalCase; commit messages imperative mood under 72 chars.

## Pull requests

- One logical change per PR. Keep diffs focused.
- Describe *why*, not just *what*.
- Link the roadmap phase or issue the change belongs to.
- New behavior should come with a test or a documented manual verification path.

## Reporting bugs & proposing features

Open a GitHub issue. For security vulnerabilities, **do not open a public issue** — see [`SECURITY.md`](SECURITY.md).
