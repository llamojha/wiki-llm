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
