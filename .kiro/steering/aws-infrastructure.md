---
title: AWS Infrastructure
inclusion: always
---

# AWS Infrastructure

Deployment-specific values (account ID, bucket name, region) are **not**
checked into this repo. Each deployment supplies its own via environment
variables — see [`docs/configuration.md`](../../docs/configuration.md).

## Required AWS resources

- An S3 bucket for the vault (one vault = one bucket + one prefix).
- Bedrock model access for `amazon.nova-2-lite-v1:0` (or a cross-region
  inference profile such as `eu.amazon.nova-2-lite-v1:0`) in your region.
- An IAM principal (user, instance role, ECS task role, or IRSA role) with
  least-privilege access to the bucket/prefix and `bedrock:InvokeModel*`.
- (Optional) A Cognito User Pool for OIDC authentication (see below).

## Environment variables

```
VAULT_BUCKET=<your-s3-bucket>
VAULT_PREFIX=<optional-key-prefix>
VAULT_REGION=<aws-region>
BEDROCK_MODEL=amazon.nova-2-lite-v1:0
BEDROCK_REGION=<aws-region>
```

Credentials come from the standard AWS credential chain (env vars, shared
config, instance/task role). Never hardcode keys or account IDs in the repo.

## Cognito (OIDC authentication)

Canopy's built-in auth gate uses any OIDC provider. AWS Cognito is first-class.

**Current preview/production deployment:**

- **User Pool:** `eu-central-1_KkuawzQ4p` (name: `canopy-preview`)
- **App Client:** `1rppevt272ado1cfbvc6igc2t8` (confidential, with secret)
- **Hosted UI domain:** `canopy-preview.auth.eu-central-1.amazoncognito.com`
- **Issuer:** `https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_KkuawzQ4p`
- **Callbacks registered:**
  - `https://wiki-llm-web-git-preview-llamojhas-projects.vercel.app/api/auth/callback`
  - `https://wiki.amllamojha.com/api/auth/callback`
  - `http://localhost:3000/api/auth/callback`
- **Sign-out URLs:** same three origins (root)

### Env vars for auth (set in Vercel for both Preview + Production):

```
AUTH_MODE=oidc
OIDC_ISSUER=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_KkuawzQ4p
OIDC_CLIENT_ID=1rppevt272ado1cfbvc6igc2t8
OIDC_CLIENT_SECRET=<from Cognito app client>
AUTH_SESSION_SECRET=<random 32+ char secret>
```

### IAM permissions for Cognito

No additional IAM permissions are required — the OIDC flow runs entirely
client-side (browser ↔ Cognito hosted UI ↔ app callback). The app never
calls Cognito APIs directly; it relies on OIDC discovery
(`/.well-known/openid-configuration`) and the standard token endpoint.

### Creating a user

Users self-register via the Cognito hosted UI, or can be admin-created:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id eu-central-1_KkuawzQ4p \
  --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --region eu-central-1
```

Remember: the user must exist in the Cognito User Pool to access the portal.
