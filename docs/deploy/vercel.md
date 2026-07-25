# Deploying to Vercel

Canopy runs on Vercel as a plain Next.js app — no adapter, no custom server.
The whole per-deployment identity of an instance (which vault, which features,
whether sign-in is required) is environment variables, so the same repo can
back several independent instances.

> **No deployment-specific values belong in this repo.** Bucket names, account
> ids, IAM keys, and domains live in the Vercel project's environment
> variables. This guide only describes shapes.

## One instance = one Vercel project

Vercel environment variables are scoped **per project and per environment
(production / preview / development)** — never per domain. Two domains attached
to the same project share one set of variables and therefore one vault.

So: **if two instances must differ in vault, feature flags, or auth, they must
be two Vercel projects**, both connected to this repo. The typical pair is

| Instance | Vault | Auth | Features |
|---|---|---|---|
| Private wiki | your real vault bucket | `AUTH_MODE=oidc` | read + write (editor, upload, search, agent) |
| Public showcase | a separate demo bucket | none (open) | read-only (search + agent) |

Both track the same branch; a push deploys both.

## Project settings

For each project:

- **Framework preset**: Next.js
- **Root directory**: `web` — the Next.js app, not the repo root. Vercel still
  clones the whole repo, so pnpm-workspace resolution against the root
  lockfile works
- **Node version**: 24.x
- **Build command / install command**: leave at the framework defaults
  (`next build` is detected inside `web/`)

The fastest way to create the second project with identical build settings is
to pull the first one's settings and reuse them:

```bash
vercel link                     # link cwd to the existing project
vercel pull --environment=production   # writes .vercel/project.json + .env
```

Then create the sibling project and set its own variables (below).

## Environment variables

Start from [`infra/.env.example`](../../infra/.env.example) — it lists every
variable with its default. The full reference is
[`docs/configuration.md`](../configuration.md).

Per project, at minimum:

```
VAULT_BUCKET=<this instance's bucket>
VAULT_REGION=<bucket region>
VAULT_ID=<display name shown in the top-bar pill>
BEDROCK_MODEL=<us.|eu.>amazon.nova-2-lite-v1:0
BEDROCK_REGION=<bedrock region>
```

Set them with the CLI (repeat per environment you deploy):

```bash
vercel env add VAULT_BUCKET production
printf '%s' "$VALUE" | vercel env add VAULT_BUCKET production   # non-interactive
```

### AWS credentials

Vercel functions have no instance role, so the standard credential chain has to
be fed explicitly: set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as
project environment variables.

**Give each instance its own IAM principal, scoped to its own bucket.** That
is what keeps a public showcase from being able to touch a private vault. A
read-mostly showcase needs only:

- `s3:GetObject`, `s3:PutObject` on `arn:aws:s3:::<demo-bucket>/*`
  (`PutObject` is still required — chat usage events are written under
  `_system/usage/`)
- `s3:ListBucket` on `arn:aws:s3:::<demo-bucket>`
- `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on the model
  or inference profile in use

Omit `s3:DeleteObject` and the curate-Lambda `lambda:InvokeFunction` unless the
instance actually enables those features. Verify the scoping after creating the
key — listing the *other* instance's bucket must fail with `AccessDenied`.

### Build-time variables

`NEXT_PUBLIC_*` variables and `NEXT_BASE_PATH` are **inlined at build time**.
Changing them requires a redeploy, not just a restart.

## Hardening an open (no sign-in) instance

An instance without `AUTH_MODE` is readable by anyone who finds the URL. Before
pointing a public domain at one:

1. **Turn every write surface off.** `FEATURE_UPLOAD`, `FEATURE_EDITOR`,
   `FEATURE_CURATE`, `FEATURE_REINDEX` — and also **`FEATURE_STAR`**, which is
   easy to mistake for read-only: the star route rewrites the document's own
   frontmatter, so on an open instance any visitor can mutate vault content.
2. **Cap the agent.** Every `POST /api/chat` invokes Bedrock and costs money.
   Set `CHAT_RATE_LIMIT` low, but do not rely on it alone — it is an in-memory
   fixed window, so on Fluid Compute it is per-instance best-effort. Add a
   Vercel WAF rate-limit rule on `/api/chat` as the enforcement, and an AWS
   Budgets alarm as the backstop. Or set `FEATURE_AGENT=off` for a
   rendering-only showcase.
3. **Leave `FEATURE_IMAGE_PROXY` off** unless the vault genuinely needs it —
   an open outbound-fetch route is an SSRF surface.
4. **Enable bucket versioning** on the demo vault so any unexpected write is
   recoverable.

## Auth callbacks

With `AUTH_MODE=oidc`, every origin the app is served from must be registered
with the identity provider as a callback and sign-out URL:

```
https://<domain>/api/auth/callback/<provider>
```

That includes Vercel's generated preview URLs if you sign in on previews.
Preview URLs are per-deployment, so prefer a **stable branch alias** (e.g. the
`git-<branch>` alias) and register that one rather than chasing hashes.

## Domains

```bash
vercel domains add <domain> <project>
vercel alias set <deployment-url> <domain>   # if not using automatic production aliasing
```

Point the DNS record at Vercel as the dashboard instructs. Each project owns
its own domain; a domain cannot be attached to two projects.
