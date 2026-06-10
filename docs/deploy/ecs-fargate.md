# Deploying to AWS ECS (Fargate)

Vaultmark runs well on Fargate: it's a single stateless container, S3 is the
source of truth, and the **task role** gives it AWS access with no static
keys anywhere.

Reference files:

- [`infra/ecs/task-definition.example.json`](../../infra/ecs/task-definition.example.json)
- [`infra/ecs/task-role-policy.example.json`](../../infra/ecs/task-role-policy.example.json)

Replace `<account-id>`, `<region>`, and `<bucket>`/`<prefix>` placeholders
throughout.

## 1. Build and push the image to ECR

```bash
aws ecr create-repository --repository-name vaultmark

aws ecr get-login-password --region <region> |
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com

docker build -f web/Dockerfile -t <account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest .
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest
```

(Build context is the repo root — the workspace lockfile lives there.)

## 2. Create the IAM roles

Two roles, with different jobs:

**Execution role** (`vaultmark-execution`) — used by ECS itself to pull the
image and write logs. Attach the AWS-managed
`AmazonECSTaskExecutionRolePolicy`.

**Task role** (`vaultmark-task`) — used by the app at runtime. Create it from
`task-role-policy.example.json`:

```bash
aws iam create-role --role-name vaultmark-task \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam put-role-policy --role-name vaultmark-task \
  --policy-name vaultmark-portal \
  --policy-document file://infra/ecs/task-role-policy.example.json
```

Drop the Bedrock statement if you run with `FEATURE_AGENT=off` and
`FEATURE_CURATE=off`, and the Lambda statement if the curate Lambda isn't
deployed. The AWS SDK picks up the task role automatically — set **no**
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in the task definition.

## 3. Register the task definition

Edit `task-definition.example.json` (image URI, env vars, role ARNs, log
region), create the log group, and register:

```bash
aws logs create-log-group --log-group-name /ecs/vaultmark

aws ecs register-task-definition \
  --cli-input-json file://infra/ecs/task-definition.example.json
```

Environment variables are documented in
[`configuration.md`](../configuration.md); feature flags in
[`feature-flags.md`](../feature-flags.md). The example ships with
`FEATURE_CURATE=off` — remove it and add `CURATE_LAMBDA_ARN` once the curate
Lambda is deployed. For secrets you'd rather not put in plain env vars, use
the task definition's `secrets` block with SSM Parameter Store or Secrets
Manager.

## 4. Create the service behind an ALB

```bash
aws ecs create-cluster --cluster-name vaultmark

# Target group (note: target-type ip for Fargate awsvpc networking)
aws elbv2 create-target-group \
  --name vaultmark --protocol HTTP --port 3000 --target-type ip \
  --vpc-id <vpc-id> \
  --health-check-path /api/vaults

aws ecs create-service \
  --cluster vaultmark \
  --service-name vaultmark \
  --task-definition vaultmark \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={
      subnets=[<private-subnet-1>,<private-subnet-2>],
      securityGroups=[<service-sg>],
      assignPublicIp=DISABLED}' \
  --load-balancers 'targetGroupArn=<tg-arn>,containerName=web,containerPort=3000'
```

Networking notes:

- Run tasks in **private subnets** with `assignPublicIp=DISABLED`; only the
  ALB lives in public subnets. The tasks need a NAT gateway **or** VPC
  endpoints (S3 gateway endpoint + Bedrock/Lambda/ECR/CloudWatch interface
  endpoints) to reach AWS APIs.
- Security groups: ALB → service on port 3000 only.
- The service is stateless — scale with `--desired-count` or attach
  Application Auto Scaling.

## 5. Authentication

Vaultmark has **no built-in auth**. On ECS the standard pattern is
[ALB authentication](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-authenticate-users.html):
add an `authenticate-oidc` (or Cognito) action to the HTTPS listener rule in
front of the forward action. Alternatively keep the ALB internal and reach it
over VPN. See [`SECURITY.md`](../../SECURITY.md).

## 6. Deploying updates

```bash
docker build -f web/Dockerfile -t <ecr-uri>:latest . && docker push <ecr-uri>:latest
aws ecs update-service --cluster vaultmark --service vaultmark --force-new-deployment
```

Flags and env vars are read at server start, so config changes are a new task
definition revision + `update-service`. `NEXT_PUBLIC_VAULT_USER_ID` is baked
in at image build time — rebuild to change it.
