# Deploying with Docker

Vaultmark ships as a single Next.js server. The image is built from
[`web/Dockerfile`](../../web/Dockerfile) using Next.js standalone output —
the final image contains only the compiled server, not the toolchain.

## Pull from GitHub Container Registry

CI publishes a multi-arch (amd64 + arm64) image to GHCR on every push to
`main` and on `v*` version tags — see
[`.github/workflows/release-image.yml`](../../.github/workflows/release-image.yml).
Each image is Trivy-scanned before publishing; fixable HIGH/CRITICAL
vulnerabilities block the release.

```bash
docker pull ghcr.io/<owner>/<repo>:latest    # tip of main
docker pull ghcr.io/<owner>/<repo>:1.2.3     # a tagged release
docker pull ghcr.io/<owner>/<repo>:sha-a1b2c3d   # exact build, for rollbacks
```

While the repository is private the package is too — authenticate with
`docker login ghcr.io` using a token that has `read:packages`.

All configuration is **runtime environment variables** (the one exception:
`NEXT_PUBLIC_*` values are inlined at build time). The image bakes in the
feature-flag defaults as `ENV` values, so `docker inspect` shows the full
tunable surface; [`infra/.env.example`](../../infra/.env.example) is the
copyable reference.

## Build

The build context must be the **repo root** (the pnpm workspace lockfile
lives there):

```bash
docker build -f web/Dockerfile -t vaultmark .
```

`NEXT_PUBLIC_*` variables are inlined at build time. If you use per-user
vault paths, pass the user id as a build arg:

```bash
docker build -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_VAULT_USER_ID=alice \
  -t vaultmark .
```

## Run

```bash
docker run -p 3000:3000 \
  -e VAULT_BUCKET=my-vault-bucket \
  -e VAULT_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  vaultmark
```

Or with an env file (see [`infra/.env.example`](../../infra/.env.example)):

```bash
docker run -p 3000:3000 --env-file .env vaultmark
```

On AWS compute (EC2/ECS/EKS) omit the static keys and let the instance/task
role provide credentials — see [`configuration.md`](../configuration.md) for
the IAM permissions and the full variable reference, and
[`feature-flags.md`](../feature-flags.md) to disable features you don't need
(e.g. `FEATURE_CURATE=off` when the curate Lambda isn't deployed).

## Docker Compose (local dev)

```bash
cp infra/.env.example infra/.env   # fill in your bucket
docker compose -f infra/docker-compose.yml up
```

## Health check

`GET /api/vaults` returns 200 with the configured vault — suitable as a
container health/readiness probe. Vaultmark has **no built-in auth**; don't
expose the port publicly without an authenticating proxy in front.
