# Configuration

Canopy is configured entirely through environment variables. There are no
config files with deployment-specific values checked into the repo.

A starter file lives at [`infra/.env.example`](../infra/.env.example) — copy it
to `web/.env.local` for local development.

## Vault (S3)

The vault is the S3 location that holds your Markdown. One vault = one bucket
+ one optional key prefix.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VAULT_BUCKET` | **yes** | — | S3 bucket holding the vault. The app refuses to start without it. |
| `VAULT_PREFIX` | no | `""` (bucket root) | Key prefix inside the bucket, e.g. `team-vault`. No leading/trailing slash. |
| `VAULT_REGION` | no | `us-east-1` | AWS region of the bucket. |
| `VAULT_ID` | no | `default` | Display id/name of the vault — shown as the top-bar pill and in `/api/vaults`. The pill is hidden while the value is unset/`default`. |

### Audit & usage logs

Audit and chat-usage events are written **one object per event** so concurrent
writers never lose each other's entries (distinct S3 PUTs never conflict):

- audit events → `_system/log/<timestamp>-<rand>.md` (one Markdown line each)
- chat-usage events → `_system/usage/<timestamp>-<rand>.json` (one JSON entry each)

Both live under a scope's `_system/` prefix (shared: `_system/…`; per user:
`users/<id>/_system/…`), so they are excluded from search, the tree, and
document reads. The legacy single-file `_system/log.md` /
`_system/usage-log.jsonl` remain as readable history where they already exist;
nothing rewrites them. To fold the per-event objects back into one file when
you want a single view:

```bash
aws s3 cp --recursive s3://<bucket>/<prefix>/_system/log/ ./log/ && cat ./log/*.md > log.md
```

## AWS credentials

Credentials are resolved through the **standard AWS credential chain** — env
vars (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), shared config
(`~/.aws/`), EC2 instance role, ECS task role, or EKS IRSA / Pod Identity.
Nothing is hardcoded; prefer roles over static keys in production.

Minimum IAM permissions:

- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/<prefix>/*`
- `s3:ListBucket` on `arn:aws:s3:::<bucket>` (optionally restricted with a prefix condition)
- `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on the model / inference profile you use (only if the agent or curation features are enabled)
- `lambda:InvokeFunction` on the curate Lambda (only if `FEATURE_CURATE` is on and the Lambda pipeline is deployed)

Example policy documents: [`infra/ecs/task-role-policy.example.json`](../infra/ecs/task-role-policy.example.json).

## Bedrock (LLM)

Used by the ask-wiki agent (`FEATURE_AGENT`) and the ingest/curation pipeline.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BEDROCK_MODEL` | no | `eu.amazon.nova-2-lite-v1:0` | Model id or cross-region inference profile for the ask-wiki agent. |
| `BEDROCK_REGION` | no | `eu-central-1` | Region for Bedrock calls. |
| `INGEST_MODEL` | no | `eu.amazon.nova-2-lite-v1:0` | Model used by the inline ingest path. |

> The defaults assume an EU deployment using the `eu.` cross-region inference
> profile. For a US deployment set `BEDROCK_MODEL=us.amazon.nova-2-lite-v1:0`
> (or the plain `amazon.nova-2-lite-v1:0` model id) and
> `BEDROCK_REGION=us-east-1`.

## Curation Lambda (optional)

The AI curation pipeline (`FEATURE_CURATE`) offloads long-running Bedrock work
to an AWS Lambda (source in [`infra/lambda/curate/`](../infra/lambda/curate/)).
If you don't deploy the Lambda, disable the feature with `FEATURE_CURATE=off`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CURATE_LAMBDA_ARN` | for curation | — | ARN of the deployed curate Lambda. Curation start returns an error without it. |
| `CURATE_LAMBDA_REGION` | no | `eu-central-1` | Region of the Lambda. |
| `VAULT_USER_ID` | no | `default` | (Lambda + ingest CLI) user id for per-user vault paths `users/<id>/…`. |
| `FEATURE_CURATE_AUTOSYNTH` | no | off | Opt-in server-side toggle that chains synthesis after a curate extraction batch completes. Not a portal `FEATURE_*` flag (no UI surface, no `flags.ts` entry) — set to `on`/`1`/`true`/`yes` to enable. See `specs/synthesis-pipeline.md`. |

## Users / personal space

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_VAULT_USER_ID` | no | `default` | The portal's default user id for personal-space paths (`users/<id>/…`). **Inlined at build time** — set it before `pnpm build` / image build, and keep it in sync with the Lambda's `VAULT_USER_ID`. |

## Serving under a sub-path (base path)

By default the portal is served at the root (`/`). To host it under a sub-path
in a shared cluster — e.g. behind an ingress that routes `/wiki` to Canopy —
set `NEXT_BASE_PATH`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_BASE_PATH` | no | `""` (root) | Sub-path the app is served under, e.g. `/wiki`. **Build-time** — Next.js `basePath` is baked into the build, so this must be set before `pnpm build` / the image build. Use a leading slash and no trailing slash (`/wiki`). |

This sets Next.js `basePath`/`assetPrefix` and is inlined as
`NEXT_PUBLIC_BASE_PATH` so client fetches, history navigation, and asset URLs
all resolve under the prefix. Pages, API routes, and assets then live under the
prefix (the home page is `/wiki`, the API is `/wiki/api/...`).

Build a prefixed image with the Docker build-arg:

```bash
docker build -f web/Dockerfile -t canopy:wiki --build-arg NEXT_BASE_PATH=/wiki .
```

The release pipeline also publishes a prebuilt `/wiki` variant under a `-wiki`
tag suffix (`ghcr.io/<owner>/<repo>:latest-wiki`, `:vX.Y.Z-wiki`,
`:sha-<short>-wiki`) so you can pull instead of build.

The container healthcheck reads the same value, so it probes
`/wiki/api/vaults` automatically. **There is no runtime override** — running
the root image and setting `NEXT_BASE_PATH=/wiki` at runtime has no effect, so
its assets stay at `/_next/` (not `/wiki/_next/`). Serving under a prefix
requires an image built for that prefix.

## Feature flags

Every product feature has a `FEATURE_*` env var, changeable at runtime
(restart required, no rebuild). Defaults: **`FEATURE_AGENT` on, every other
feature off**. Set a var to `off` (or `false`/`0`/`no`/`disabled`) to
disable, or to `on` to enable. The container image bakes the defaults in as
`ENV` values and [`infra/.env.example`](../infra/.env.example) lists every
flag, so the full tunable surface is visible per deployment. See
[`feature-flags.md`](feature-flags.md) for the full reference.

## Authentication (auth gate)

Canopy ships an optional **built-in OIDC auth gate**, off by default. When
off, the portal is exactly the open app it has always been (put a reverse
proxy / ALB OIDC / VPN in front, per [`SECURITY.md`](../SECURITY.md)). When on,
it answers a single binary question — *may this person enter the portal at
all?* — via any OpenID Connect provider. **Keycloak and AWS Cognito are both
first-class and verified.** It is not multi-user identity (that is a later
phase); everyone who passes the allowlist sees the same vault.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AUTH_MODE` | no | `none` | `none` (open portal — unchanged behavior), or `oidc` (built-in gate). `proxy` is reserved for a future trusted-header mode. |
| `OIDC_ISSUER` | in `oidc` | — | Issuer URL. Keycloak: `https://<host>/realms/<realm>`. Cognito: `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`. Discovery is read from `<issuer>/.well-known/openid-configuration`. |
| `OIDC_CLIENT_ID` | in `oidc` | — | OIDC client (app client) id. |
| `OIDC_CLIENT_SECRET` | in `oidc` | — | Client secret (confidential client). |
| `AUTH_SESSION_SECRET` | in `oidc` | — | High-entropy secret (≥ 32 chars) used to encrypt the session cookie. Rotating it invalidates all sessions. |
| `AUTH_ALLOWED_SUBJECTS` | one of the two | — | Comma/space-separated allowlist of OIDC `sub` claims permitted in. |
| `AUTH_ALLOWED_EMAILS` | one of the two | — | Comma/space-separated allowlist of `email` claims (case-insensitive). |

**Deny-by-default.** In `oidc` mode an authenticated user is admitted **only**
if their `sub` or `email` is on an allowlist. An empty/unset allowlist admits
**no one** (fail closed) — authenticating at your IdP is not the same as being
allowed into this portal. Removing someone from the allowlist takes effect on
their next request.

**Both layers.** Pages redirect unauthenticated browsers to sign-in; every
`/api/*` handler independently returns `401` (auth is checked before the
feature flag, so a disabled feature returns `401` before `404` and never leaks
which features exist). The exemptions are `/api/health` (probes),
`/api/auth/*` (the sign-in routes themselves), and static assets. Sessions are
a stateless encrypted cookie (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS,
scoped to `NEXT_BASE_PATH`); there is no server-side store, so **revocation is
expiry-bound** (TTL 12h). The OIDC redirect/callback URLs compose with
`NEXT_BASE_PATH` automatically.

### Keycloak recipe

1. Create (or pick) a realm, then a **client**: Client type `OpenID Connect`,
   Client authentication **On** (confidential), Standard flow enabled.
2. Valid redirect URI: `https://<your-host><basePath>/api/auth/callback`
   (e.g. `https://wiki.example.com/api/auth/callback`, or
   `…/wiki/api/auth/callback` when `NEXT_BASE_PATH=/wiki`).
3. Valid post-logout redirect URI: `https://<your-host><basePath>/`.
4. Copy the client secret. Set:

```
AUTH_MODE=oidc
OIDC_ISSUER=https://keycloak.example.com/realms/canopy
OIDC_CLIENT_ID=canopy
OIDC_CLIENT_SECRET=<from Keycloak>
AUTH_SESSION_SECRET=<openssl rand -hex 32>
AUTH_ALLOWED_EMAILS=you@example.com,teammate@example.com
```

Keycloak advertises a standard `end_session_endpoint`, so logout is
RP-initiated (the portal sends `post_logout_redirect_uri` + `id_token_hint`).

### AWS Cognito recipe

1. In your **user pool**, add a **Hosted UI domain** (App integration → Domain)
   — Cognito's authorize/token/logout endpoints live on that domain.
2. Create an **app client** (confidential, with a secret). Enable the
   Authorization code grant and the `openid email profile` scopes.
3. Allowed callback URL: `https://<your-host><basePath>/api/auth/callback`.
4. Allowed sign-out URL: `https://<your-host><basePath>/` (Cognito calls this
   `logout_uri`; it must be registered here).

```
AUTH_MODE=oidc
OIDC_ISSUER=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_ABC123
OIDC_CLIENT_ID=<app client id>
OIDC_CLIENT_SECRET=<app client secret>
AUTH_SESSION_SECRET=<openssl rand -hex 32>
AUTH_ALLOWED_EMAILS=you@example.com
```

> **Cognito note.** Cognito's discovery document omits `end_session_endpoint`,
> so Canopy derives the non-standard logout
> (`https://<hosted-domain>/logout?client_id=…&logout_uri=…`) from the
> discovered authorization endpoint — no host is hardcoded. This is handled
> automatically; you only need the sign-out URL registered (step 4).

## Uploads

Gated behind `FEATURE_UPLOAD`. The upload route caps the accepted file size to
protect the shared Next.js process from oversized payloads.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `UPLOAD_MAX_BYTES` | no | `2097152` (2 MiB) | Max accepted size, in bytes, for `POST /api/upload`. Larger files are rejected with `413`. |

## Theming

Themes are drop-in CSS plugin files — see [`theming.md`](theming.md) for the
authoring guide and variable reference.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `THEME_DIR` | no | `<app cwd>/themes` (= `web/themes/`) | Directory scanned for `*.css` theme plugin files. |
| `THEME_DEFAULT` | no | `dark` | Theme id rendered before a visitor picks one (`light`, `dark`, or a plugin's filename slug). |
| `THEME_VAULT_PREFIX` | no | unset | S3 key prefix (inside the vault) scanned for `*.css` theme plugins at startup; disabled when unset. See [`theming.md`](theming.md). |

## Debugging

| Variable | Default | Purpose |
|---|---|---|
| `DEBUG_AGENT` | off | Set to `1` or `true` to stream per-round agent traces (tool calls, stop reasons) to the server log. |
| `DEBUG_S3` | off | Set to `1` or `true` to trace every S3 object operation (`GET`/`PUT`/`DELETE`/`LIST`, with key and byte size) to the server log. The resolved S3 runtime config (bucket, prefix, region, `useMock`) is logged once at startup regardless of this flag. |

## Build-time vs runtime

Most variables are read at **runtime** by the Node server, so you can change
them per environment without rebuilding. The exceptions are `NEXT_PUBLIC_*`
variables and `NEXT_BASE_PATH`, which Next.js inlines into the build — changing
those requires a rebuild of the app/image.
