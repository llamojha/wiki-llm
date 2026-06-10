# Deploying to Kubernetes

Reference manifests live in [`infra/k8s/`](../../infra/k8s/). They work on any
Kubernetes cluster; the IAM sections below are EKS-specific.

```
infra/k8s/
├── namespace.yaml          vaultmark namespace
├── configmap.yaml          env config (vault, Bedrock, feature flags)
├── serviceaccount.yaml     service account (IRSA annotation for EKS)
├── secret.example.yaml     static AWS keys — only for non-EKS clusters
├── deployment.yaml         the portal (2 replicas, probes on /api/vaults)
├── service.yaml            ClusterIP service
└── ingress.yaml            ingress (bring your own controller + auth)
```

## 1. Build and push the image

```bash
docker build -f web/Dockerfile -t <registry>/vaultmark:latest .
docker push <registry>/vaultmark:latest
```

For ECR: `aws ecr create-repository --repository-name vaultmark` and use
`<account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest` as the registry
path.

## 2. Grant AWS access

The pod needs S3 access to the vault bucket, plus Bedrock (and optionally
Lambda invoke) if the LLM features are enabled — the exact permissions are in
[`configuration.md`](../configuration.md), with a ready-made policy document
at [`infra/ecs/task-role-policy.example.json`](../../infra/ecs/task-role-policy.example.json)
(it's plain IAM JSON; it works for any role, not just ECS).

**EKS (recommended) — IRSA:**

```bash
# Create an IAM role for the vaultmark service account with the policy above
eksctl create iamserviceaccount \
  --cluster <cluster> \
  --namespace vaultmark \
  --name vaultmark \
  --attach-policy-arn arn:aws:iam::<account-id>:policy/vaultmark-portal \
  --approve
```

Or create the role manually and put its ARN in the
`eks.amazonaws.com/role-arn` annotation in `serviceaccount.yaml`.
[EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)
works equally well — no manifest changes needed beyond removing the IRSA
annotation.

**Non-EKS clusters:** create an IAM user with the same policy, then create
the secret from `secret.example.yaml` (never commit real keys) and uncomment
the `secretRef` block in `deployment.yaml`.

## 3. Configure

Edit `configmap.yaml`:

- `VAULT_BUCKET` / `VAULT_PREFIX` / `VAULT_REGION` — your vault location.
- `BEDROCK_MODEL` / `BEDROCK_REGION` — match your region (`us.` vs `eu.`
  inference profile).
- Feature flags — `FEATURE_CURATE` is `off` in the example because the curate
  Lambda is optional; remove that line once you've deployed it and set
  `CURATE_LAMBDA_ARN`. See [`feature-flags.md`](../feature-flags.md).

Set the image in `deployment.yaml`.

## 4. Deploy

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/configmap.yaml
kubectl apply -f infra/k8s/serviceaccount.yaml
kubectl apply -f infra/k8s/deployment.yaml
kubectl apply -f infra/k8s/service.yaml
kubectl apply -f infra/k8s/ingress.yaml   # after editing host + class

kubectl -n vaultmark rollout status deploy/vaultmark
kubectl -n vaultmark port-forward svc/vaultmark 3000:80   # smoke test
```

## Notes

- **Authentication:** Vaultmark has no built-in auth. Keep the ingress
  internal, or front it with oauth2-proxy / your IdP — there's a commented
  `auth-url` example in `ingress.yaml`. See [`SECURITY.md`](../../SECURITY.md).
- **Scaling:** the app is stateless (S3 is the source of truth) — it scales
  horizontally. The search index is built in-memory per pod, so the first
  search on a fresh pod is slower on large vaults.
- **Config changes:** flags and env are read at server start; restart pods
  after editing the ConfigMap
  (`kubectl -n vaultmark rollout restart deploy/vaultmark`).
- **`NEXT_PUBLIC_VAULT_USER_ID`** is baked in at image build time, not via
  the ConfigMap — rebuild the image to change it.
