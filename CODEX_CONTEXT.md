# Codex Context — Vaultmark Curation Pipeline

## What just happened

We implemented a Karpathy-style curation pipeline that moves heavy LLM processing from Vercel (which was timing out) to an AWS Lambda. The full spec is in `specs/curation-pipeline.md`.

### Architecture

```
Browser → Vercel POST /api/curate/start → creates job in S3, invokes Lambda async → returns jobId
Browser → Vercel GET /api/curate/status?job=X → reads _jobs/{id}.json from S3 → returns progress
Lambda (5 min timeout) → for each raw file: single Bedrock call → parse <file> XML blocks → write pages to S3
```

### Key files created/modified this session

| Path | What |
|---|---|
| `infra/lambda/curate/` | Lambda package (TypeScript, esbuild bundle) |
| `infra/lambda/curate/index.ts` | Handler — iterates files, timeout safety, job state |
| `infra/lambda/curate/ingest.ts` | Single-source orchestration — context → Bedrock → parse → write |
| `infra/lambda/curate/bedrock.ts` | Free-form Converse call (no tool_use) |
| `infra/lambda/curate/prompt.ts` | Karpathy-style system + user prompt |
| `infra/lambda/curate/parse.ts` | `<file path="...">content</file>` XML block parser |
| `infra/lambda/curate/manifest.ts` | `_processed.json` — tracks processed files by SHA-256 hash |
| `infra/lambda/curate/job.ts` | `_jobs/{id}.json` — job state CRUD |
| `infra/lambda/curate/s3.ts` | S3 helpers (get/put/list) |
| `infra-cdk/lib/infra-cdk-stack.ts` | CDK stack — Lambda + IAM only (replaced old ECS/RDS stack) |
| `web/app/api/curate/start/route.ts` | Vercel route — creates job, invokes Lambda async |
| `web/app/api/curate/status/route.ts` | Vercel route — reads job state from S3 |
| `web/app/api/curate/cancel/route.ts` | Vercel route — marks job cancelled |
| `web/app/api/raw/route.ts` | Updated — manifest-based pending detection |
| `web/components/upload-modal.tsx` | Updated — polling-based progress (was streaming) |

### Current deployment state

- **Lambda deployed:** `arn:aws:lambda:eu-central-1:858650446023:function:vaultmark-curate`
- **IAM granted:** `vaultmark-vercel` user has `lambda:InvokeFunction` on the Lambda
- **Vercel env var needed:** `CURATE_LAMBDA_ARN=arn:aws:lambda:eu-central-1:858650446023:function:vaultmark-curate`
- **Lambda needs redeployment** after code review fixes: `cd infra-cdk && npx cdk deploy`

### What's NOT done yet

- End-to-end test with a real file (Lambda deployed but Vercel hasn't been redeployed with the new env var yet)
- The old `web/lib/ingest/` directory still exists (can be removed after confirming Lambda works)
- Reindex endpoint still uses the old inline approach (not Lambda-based — that's fine per spec)

## Kiro-specific context

### Steering docs (`.kiro/steering/`)

These are "always include" context files that Kiro loads automatically:

- `philosophy.md` — Markdown-first, minimal scope, pixel parity, user-confirmed writes
- `architecture.md` — Partially superseded by ROADMAP.md (describes old FastAPI/Postgres shape)
- `tech-stack.md` — Pinned versions, explicit out-of-scope list
- `development-standards.md` — Frontend/backend standards, rendering, mock data rules
- `conventions.md` — Naming, imports, API patterns, git conventions
- `aws-infrastructure.md` — Account 858650446023, bucket `vaultmark`, region `eu-central-1`

### Source precedence (from AGENTS.md)

1. User request in current thread
2. `ROADMAP.md` for active phase and locked decisions
3. `prd_vaultmark_markdown_llm_wiki.md` for product intent
4. `.kiro/steering/*.md` for engineering principles
5. `.kiro/specs/*` and `.kiro/prompts/*` as reference only

### Skills (`.kiro/skills/`)

- `prompt-optimizer` — Optimize prompts via Bedrock OptimizePrompt API

### Key conventions

- pnpm workspace (root `package.json` has workspace scripts)
- `web/` is the active Next.js 16.2 app (App Router, RSC, plain CSS, no Tailwind)
- `ingest/` is a TypeScript CLI package (older, may be superseded by Lambda)
- `portal/` is the Babel-in-browser prototype (design reference, don't extend)
- `api/` is archived FastAPI backend (reference only)
- `infra-cdk/` is the CDK stack (now Lambda-only)
- Never import from `portal/` or `legacy/` in production code
- Server Components by default, `'use client'` only for interactivity
- Sanitize all rendered Markdown (remark + rehype-sanitize)

### AWS defaults

```
VAULT_BUCKET=vaultmark
VAULT_PREFIX=project-vaultmark  (in .env.local — but Lambda uses empty prefix)
VAULT_REGION=eu-central-1 (but .env.local says us-east-1 — check which is correct for your context)
BEDROCK_MODEL=eu.amazon.nova-2-lite-v1:0
```

### Commands

```bash
pnpm dev                    # Start web app
pnpm build                  # Build web app
pnpm typecheck              # Typecheck web app

# Lambda
cd infra/lambda/curate
npm run build               # esbuild → dist/index.mjs
npm test                    # Jest (11 tests)
npx tsc --noEmit            # Typecheck

# CDK
cd infra-cdk
npx cdk synth               # Verify template
npx cdk deploy              # Deploy Lambda to AWS
```
