# Canopy

An S3-backed Markdown knowledge portal for individuals and engineering teams.

Markdown in object storage is the durable knowledge layer. The portal renders, searches, and lets a Bedrock-powered agent answer questions grounded in your own documents.

> Canopy. Your own wiki, powered by LLM, backed by S3.

## Status

Early MVP. Phases 0-5 are implemented in the single Next.js app shape tracked by `ROADMAP.md`: S3 read/search, personal wiki CRUD, Lambda-backed curation, and the Bedrock ask-wiki agent.

- **Product spec:** [`prd_canopy_markdown_llm_wiki.md`](prd_canopy_markdown_llm_wiki.md)
- **Engineering plan:** [`ROADMAP.md`](ROADMAP.md)
- **Documentation:** [`docs/`](docs/) — configuration, feature flags, deployment
- **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md)

## What it does

- **Vault:** Markdown stored in an S3 bucket and prefix you own. Source of truth lives in object storage, not a database.
- **Portal:** browse, render, and search your vault from a clean Next.js UI.
- **Personal wiki:** create and maintain your own pages alongside project or team content.
- **AI curation:** upload raw sources and let a Lambda-backed Bedrock pipeline turn them into structured wiki pages.
- **Ask-wiki agent:** a Bedrock Nova 2 Lite agent that reads your vault, cites sources, and proposes new pages — every write is user-confirmed.

Every feature is individually toggleable via [feature flags](docs/feature-flags.md), down to a fully read-only published wiki.

## Stack

| Layer | Technology |
|---|---|
| App | Next.js 16.2, React 19, TypeScript 6.x |
| API | Next.js Route Handlers (server-side) |
| Storage | AWS S3 (Markdown blobs) |
| Search | In-memory fuzzy search (Fuse.js) |
| LLM | Amazon Bedrock — Nova 2 Lite (`amazon.nova-2-lite-v1:0`) |
| Deploy | Docker, Kubernetes, ECS Fargate, Vercel, or any Node.js host |

## Repo layout

```
wiki-llm/
├── web/          Next.js portal (frontend + API route handlers)
├── ingest/       TypeScript CLI for vault init + batch ingest
├── video/        Demo-video workspace
├── infra/
│   ├── lambda/curate/   AI curation Lambda
│   ├── k8s/             Kubernetes manifests
│   ├── ecs/             ECS Fargate task definition + IAM policy
│   └── docker-compose.yml
├── infra-cdk/    AWS CDK deploy stack
├── tests/        Playwright e2e suite (mock-S3 backed)
├── docs/         Configuration, feature flags, deployment guides
├── specs/        Phase acceptance specs
├── api/          FastAPI backend (archived — replaced by Route Handlers)
├── legacy/       Archived wiki-llm CLI (frozen reference)
├── ROADMAP.md    Engineering plan — phases are the contract
└── prd_canopy_markdown_llm_wiki.md   Product spec
```

## Getting started

### Prerequisites

- Node.js 26+ (Active LTS) and pnpm
- An S3 bucket you own, and AWS credentials with access to it
- (Optional, for AI features) Amazon Bedrock model access for Nova 2 Lite

### Local dev

```bash
# Install dependencies
pnpm install

# Set env vars
cp infra/.env.example web/.env.local
# Edit web/.env.local with your S3 bucket/prefix

# Start the app
pnpm dev   # http://localhost:3000
```

### Try it with no AWS — the built-in docs

To explore the portal with zero configuration, run it against the in-memory S3
mock and seed it with this repo's own [`openwiki/`](openwiki/) documentation:

```bash
pnpm dev:mock        # starts the app with MOCK_S3=1 (empty vault)
pnpm seed:openwiki   # loads openwiki/*.md into the mock vault (folders mode)
```

The top-level `openwiki/` folders (`architecture`, `testing`, `operations`,
`workflows`) become the vault's spaces. No AWS credentials or bucket required.

Minimum configuration:

```
VAULT_BUCKET=your-s3-bucket
VAULT_PREFIX=your-prefix
VAULT_REGION=us-east-1
```

AWS credentials are picked up from the standard chain (`~/.aws/credentials`, instance role, env vars). No hardcoding. The full environment reference — Bedrock models, curation Lambda, per-user paths, debugging — is in [`docs/configuration.md`](docs/configuration.md).

### Feature flags

The ask-wiki agent (`FEATURE_AGENT`) ships **on** by default; every other feature (`FEATURE_UPLOAD`, `FEATURE_CURATE`, `FEATURE_REINDEX`, `FEATURE_EDITOR`, `FEATURE_SEARCH`, `FEATURE_STAR`, `FEATURE_PUBLISHING`, `FEATURE_IMAGE_PROXY`) defaults **off** and is opted in per deployment by setting its `FEATURE_*` var (any value except `off`/`false`/`0`/`no`/`disabled`). Flags gate both the UI and the API routes. See [`docs/feature-flags.md`](docs/feature-flags.md).

### Verification

```bash
pnpm typecheck                              # tsc --noEmit
pnpm test:unit                              # vitest — pure-function unit tests
VAULT_BUCKET=build-placeholder pnpm build   # required before e2e
pnpm test:e2e                               # Playwright — runs against an in-memory S3 mock (no AWS)
```

The e2e suite requires a prior `pnpm build`; it starts flags-on and flags-off Next servers and drives the real API routes with `MOCK_S3=1`. All four run in CI.

## S3 vault layout

```
s3://<bucket>/<prefix>/
  raw/                    Shared source documents
  generated/<space>/      Shared AI-generated pages
  authored/<space>/       Shared human-authored pages
  _system/                Shared indexes, jobs, manifests, logs
  users/<user-id>/
    raw/
    generated/<space>/
    authored/<space>/
    _system/
  assets/                 Images and binary assets
```

Common commands:

```bash
pnpm dev
pnpm typecheck
pnpm build
pnpm ingest -- --help
```

## Deployment

The app is a standard Next.js server — one stateless container, S3 as the only state.

| Target | Guide |
|---|---|
| Docker / Compose | [`docs/deploy/docker.md`](docs/deploy/docker.md) |
| Kubernetes (incl. EKS) | [`docs/deploy/kubernetes.md`](docs/deploy/kubernetes.md) |
| ECS Fargate | [`docs/deploy/ecs-fargate.md`](docs/deploy/ecs-fargate.md) |
| Vercel | Connect the repo, set env vars in the dashboard, deploy. |

> **Authentication:** Canopy ships a built-in OIDC auth gate (off by default). Enable it to require sign-in via any OpenID Connect provider — Keycloak and AWS Cognito are both first-class. See the [Authentication section](#authentication) below and [`docs/configuration.md`](docs/configuration.md).

## Authentication

Canopy ships a **built-in OIDC auth gate** — off by default (`AUTH_MODE=none`).
When enabled, it requires sign-in through any standard OpenID Connect provider
before accessing the portal. **Keycloak** and **AWS Cognito** are both
first-class and tested.

### Quick start (Cognito)

1. Create a Cognito User Pool and add a Hosted UI domain.
2. Create a confidential app client with the `openid email profile` scopes
   and the **Authorization code** grant.
3. Add callback URL: `https://<your-host>/api/auth/callback`
4. Add sign-out URL: `https://<your-host>/`
5. Set the env vars:

```bash
AUTH_MODE=oidc
OIDC_ISSUER=https://cognito-idp.<region>.amazonaws.com/<userPoolId>
OIDC_CLIENT_ID=<app-client-id>
OIDC_CLIENT_SECRET=<app-client-secret>
AUTH_SESSION_SECRET=$(openssl rand -hex 32)
```

### Key design decisions

- **IdP is the access boundary.** If a user can authenticate with the OIDC
  provider (e.g. they exist in the Cognito User Pool), they are admitted.
  Control access by controlling who is in your User Pool.
- **Both layers enforced.** Pages redirect to sign-in; API routes return
  `401` independently. A disabled feature returns `401` before `404`.
- **Stateless sessions.** Encrypted `HttpOnly` cookie, no server-side store.
  Revocation is expiry-bound (12h TTL). Rotate `AUTH_SESSION_SECRET` to
  invalidate all sessions.
- **Provider-agnostic.** Any OIDC provider with a standard
  `.well-known/openid-configuration` works. Cognito's non-standard logout
  endpoint is handled automatically.

Full reference with Keycloak and Cognito recipes:
[`docs/configuration.md`](docs/configuration.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Read the PRD and ROADMAP before opening an issue or PR — the roadmap phases are the contract, and deviations need a conversation.

- Security reports: [`SECURITY.md`](SECURITY.md) (please don't open public issues for vulnerabilities)
- Community standards: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## License

[MIT](LICENSE)
