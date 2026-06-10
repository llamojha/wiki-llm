# Configuration

Vaultmark is configured entirely through environment variables. There are no
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
| `VAULT_ID` | no | `default` | Display id/name of the vault in the UI and `/api/vaults`. |

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

## Users / personal space

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_VAULT_USER_ID` | no | `default` | The portal's default user id for personal-space paths (`users/<id>/…`). **Inlined at build time** — set it before `pnpm build` / image build, and keep it in sync with the Lambda's `VAULT_USER_ID`. |

## Feature flags

Every product feature has a `FEATURE_*` env var. All features are **on by
default**; set a var to `off` (or `false`/`0`/`no`/`disabled`) to disable.
See [`feature-flags.md`](feature-flags.md) for the full reference.

## Debugging

| Variable | Default | Purpose |
|---|---|---|
| `DEBUG_AGENT` | off | Set to `1` or `true` to stream per-round agent traces (tool calls, stop reasons) to the server log. |

## Build-time vs runtime

Most variables are read at **runtime** by the Node server, so you can change
them per environment without rebuilding. The exceptions are `NEXT_PUBLIC_*`
variables, which Next.js inlines into the build — changing those requires a
rebuild of the app/image.
