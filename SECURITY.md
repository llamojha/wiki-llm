# Security Policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository ("Security" tab → "Report a vulnerability"). You should receive an acknowledgement within a few days.

## Scope

Vaultmark renders user-supplied Markdown and talks to AWS (S3, Bedrock, Lambda) with the credentials you give it. Reports we particularly care about:

- Markdown sanitization bypasses (XSS through rendered documents)
- Path traversal in document IDs / S3 key construction
- Feature-flag route guards being bypassable (`web/lib/flags.ts`)
- Prompt-injection paths that lead to **unconfirmed** vault writes by the agent
- Leakage of AWS credentials or vault content across requests

## Deployment hardening notes

- Vaultmark has **no built-in authentication or multi-tenancy** — it assumes a trusted network boundary. Do not expose a deployment to the public internet without an auth layer in front (reverse-proxy auth, VPN, IAP, etc.).
- Run with least-privilege IAM: scope S3 permissions to the vault bucket/prefix and Bedrock permissions to the model you use. Example policies live in `infra/ecs/` and `docs/deploy/`.
- Disabled features return 404 via route guards, but the read path (`GET /api/docs`, tree, search index build) is always available to anyone who can reach the app.

## Supported versions

Pre-1.0: only the latest `main` is supported. There are no backported security fixes.
