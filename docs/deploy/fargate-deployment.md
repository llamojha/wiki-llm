# How to Deploy to AWS ECS Fargate

A step-by-step, repeatable guide for building the Vaultmark web container and
running it on ECS Fargate, plus the two non-obvious gotchas that will bite you
if you skip them.

Vaultmark is a single stateless container — S3 is the only state, and the ECS
**task role** grants AWS access with no static keys. That makes it a clean fit
for Fargate.

> Replace every `<placeholder>` below with your own values. Nothing in this
> guide contains account IDs, IPs, ARNs, or other environment-specific data.

## Prerequisites

- AWS CLI configured with credentials that can manage ECR, ECS, IAM, EC2, and CloudWatch Logs.
- Docker with `buildx` (Docker Desktop or equivalent).
- An S3 bucket that already holds your vault, and you know:
  - the **bucket name** (`<bucket>`)
  - the **bucket region** (`<bucket-region>`) — this can differ from where you run Fargate
  - the **key prefix** your vault lives under (`<prefix>`) — see [Gotcha 2](#gotcha-2-vault_prefix-must-match-your-s3-layout)
- A target region to run the tasks in (`<region>`).
- A VPC with at least one subnet. The default VPC and its public subnets are fine for a validation deployment.

### Decide your CPU architecture early

Fargate supports both `X86_64` and `ARM64` (Graviton). Build the image for the
**same architecture** you set in the task definition, otherwise the task will
fail to start.

- On Apple Silicon / ARM hosts, building **ARM64** natively is fastest and cheapest.
- On Intel hosts, or if you need X86_64, build with `--platform linux/amd64`.

This guide uses `ARM64`; swap the value if you need X86_64.

## 1. Build and smoke-test the image locally

Build from the **repo root** (the pnpm workspace lockfile lives there):

```bash
docker build --platform linux/arm64 -f web/Dockerfile -t vaultmark:latest .
```

Then smoke-test it locally against your real bucket before pushing. Supply AWS
credentials and the vault config as environment variables:

```bash
docker run -d --name vm-smoke -p 3001:3000 \
  -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... -e AWS_SESSION_TOKEN=... \
  -e VAULT_BUCKET=<bucket> \
  -e VAULT_REGION=<bucket-region> \
  -e VAULT_PREFIX=<prefix> \
  vaultmark:latest

# Expect HTTP 200 from both:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/vaults
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/

docker rm -f vm-smoke
```

> Tip: a host-side `curl` to the mapped port goes over IPv4 and will succeed
> even if the **in-container** health check is broken. See [Gotcha 1](#gotcha-1-health-check-must-use-1270014-not-localhost).
> To catch that, run the health check command *inside* the container:
> ```bash
> docker exec vm-smoke sh -c 'wget -q -O /dev/null http://127.0.0.1:3000/api/vaults; echo $?'
> ```

## 2. Create the ECR repository and push the image

```bash
aws ecr create-repository --repository-name vaultmark \
  --region <region> --image-scanning-configuration scanOnPush=true

aws ecr get-login-password --region <region> \
  | docker login --username AWS --password-stdin \
      <account-id>.dkr.ecr.<region>.amazonaws.com

docker tag vaultmark:latest <account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest
```

## 3. Create the IAM roles

Two roles with different jobs.

**Execution role** — used by ECS itself to pull the image and write logs:

```bash
aws iam create-role --role-name vaultmark-execution \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy --role-name vaultmark-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

**Task role** — used by the app at runtime for least-privilege S3 (and optional
Bedrock) access:

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
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "VaultBucketList",
        "Effect": "Allow",
        "Action": ["s3:ListBucket"],
        "Resource": "arn:aws:s3:::<bucket>"
      },
      {
        "Sid": "VaultObjects",
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        "Resource": "arn:aws:s3:::<bucket>/<prefix>*"
      },
      {
        "Sid": "BedrockInvoke",
        "Effect": "Allow",
        "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        "Resource": [
          "arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0",
          "arn:aws:bedrock:*:<account-id>:inference-profile/*.amazon.nova-2-lite-v1:0"
        ]
      }
    ]
  }'
```

Drop the `BedrockInvoke` statement if you run with `FEATURE_AGENT=off` and
`FEATURE_CURATE=off`. The SDK picks up the task role automatically — set **no**
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in the task definition.

## 4. Create the log group and register the task definition

```bash
aws logs create-log-group --log-group-name /ecs/vaultmark --region <region>
```

Register the task definition. Note the two corrected values highlighted in the
gotchas: `VAULT_PREFIX` set to your real prefix, and the health check using
`127.0.0.1`.

```bash
aws ecs register-task-definition --region <region> --cli-input-json '{
  "family": "vaultmark",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": {
    "cpuArchitecture": "ARM64",
    "operatingSystemFamily": "LINUX"
  },
  "executionRoleArn": "arn:aws:iam::<account-id>:role/vaultmark-execution",
  "taskRoleArn": "arn:aws:iam::<account-id>:role/vaultmark-task",
  "containerDefinitions": [{
    "name": "web",
    "image": "<account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest",
    "essential": true,
    "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
    "environment": [
      { "name": "VAULT_BUCKET",   "value": "<bucket>" },
      { "name": "VAULT_PREFIX",   "value": "<prefix>" },
      { "name": "VAULT_REGION",   "value": "<bucket-region>" },
      { "name": "VAULT_ID",       "value": "default" },
      { "name": "BEDROCK_MODEL",  "value": "us.amazon.nova-2-lite-v1:0" },
      { "name": "BEDROCK_REGION", "value": "<bedrock-region>" },
      { "name": "FEATURE_CURATE", "value": "off" }
    ],
    "healthCheck": {
      "command": ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:3000/api/vaults || exit 1"],
      "interval": 30,
      "timeout": 5,
      "retries": 3,
      "startPeriod": 20
    },
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/vaultmark",
        "awslogs-region": "<region>",
        "awslogs-stream-prefix": "web"
      }
    }
  }]
}'
```

## 5. Create the cluster, security group, and service

```bash
aws ecs create-cluster --cluster-name vaultmark \
  --capacity-providers FARGATE --region <region>
```

Create a security group for the task. For a **validation** deployment that you
reach directly (no load balancer), allow inbound `3000` from **your IP only** —
Vaultmark has no built-in auth, so never open it to `0.0.0.0/0`:

```bash
aws ec2 create-security-group --group-name vaultmark-task-sg \
  --description "Vaultmark Fargate task SG" \
  --vpc-id <vpc-id> --region <region>

aws ec2 authorize-security-group-ingress --group-id <sg-id> --region <region> \
  --ip-permissions 'IpProtocol=tcp,FromPort=3000,ToPort=3000,IpRanges=[{CidrIp=<your-ip>/32}]'
```

Run the service. Using **public subnets with `assignPublicIp=ENABLED`** lets
the task pull from ECR and reach S3/Bedrock over the internet gateway without a
NAT gateway — ideal for a quick validation:

```bash
aws ecs create-service --region <region> \
  --cluster vaultmark \
  --service-name vaultmark \
  --task-definition vaultmark \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={
      subnets=[<subnet-a>,<subnet-b>,<subnet-c>],
      securityGroups=[<sg-id>],
      assignPublicIp=ENABLED}'
```

> **Production networking:** run tasks in **private subnets** with
> `assignPublicIp=DISABLED` behind an ALB, and give them a NAT gateway **or**
> VPC endpoints (S3 gateway endpoint + ECR/CloudWatch/Bedrock interface
> endpoints). Put auth in front via ALB OIDC/Cognito or a VPN. See
> [`ecs-fargate.md`](ecs-fargate.md) for the ALB variant.

## 6. Verify it runs healthy

```bash
# Get the running task
TASK=$(aws ecs list-tasks --cluster vaultmark --desired-status RUNNING \
  --region <region> --query 'taskArns[0]' --output text)

# Check lastStatus + healthStatus (want RUNNING + HEALTHY)
aws ecs describe-tasks --cluster vaultmark --tasks "$TASK" --region <region> \
  --query 'tasks[0].[lastStatus,healthStatus]' --output text

# Resolve the task's public IP
ENI=$(aws ecs describe-tasks --cluster vaultmark --tasks "$TASK" --region <region> \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" --output text)
aws ec2 describe-network-interfaces --network-interface-ids "$ENI" --region <region> \
  --query 'NetworkInterfaces[0].Association.PublicIp' --output text
```

Open `http://<task-public-ip>:3000` from the IP you allow-listed.

> The task public IP changes every time a task is replaced. For a stable
> address, put an ALB in front (fixed DNS name) — the validation flow above
> trades stability for not needing a load balancer.

Inspect logs anytime:

```bash
aws logs tail /ecs/vaultmark --region <region> --follow
```

## 7. Deploying updates

```bash
docker build --platform linux/arm64 -f web/Dockerfile \
  -t <account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest .
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/vaultmark:latest

aws ecs update-service --cluster vaultmark --service vaultmark \
  --force-new-deployment --region <region>
```

Config changes (env vars, feature flags) are a new task-definition revision
followed by `update-service --task-definition vaultmark:<n>`. `NEXT_PUBLIC_*`
vars are baked in at image build time — rebuild to change them.

---

## Gotchas

These two cost real debugging time. Both are easy to miss because a local
host-side test passes while the Fargate task fails.

### Gotcha 1: health check must use `127.0.0.1`, not `localhost`

**Symptom:** the container starts and logs `✓ Ready`, but ECS marks it
`UNHEALTHY` and kills/replaces the task on a loop every few minutes. Logs show
only the startup lines and no request activity.

**Cause:** the Next.js standalone server binds to **IPv4** `0.0.0.0:3000`. In
the Alpine container, `localhost` resolves to the **IPv6** loopback `::1` first.
`wget http://localhost:3000/...` hits `::1`, finds nothing listening, and
returns `Connection refused` → non-zero exit → failed health check.

**Why local testing hid it:** a host `curl http://localhost:3001` goes through
Docker's IPv4 port mapping and succeeds. The bug only appears when the health
check runs *inside* the container.

**Fix:** use `http://127.0.0.1:3000/api/vaults` in the health check command
(forces IPv4). Verify in-container:

```bash
docker exec <container> sh -c 'wget -q -O /dev/null http://127.0.0.1:3000/api/vaults; echo $?'   # 0 = healthy
docker exec <container> sh -c 'wget -q -O /dev/null http://localhost:3000/api/vaults;  echo $?'   # 1 = the bug
```

### Gotcha 2: `VAULT_PREFIX` must match your S3 layout

**Symptom:** the app loads and `/api/vaults` returns `200`, but the UI shows
**no documents** — an empty vault.

**Cause:** the bucket isn't empty; the content lives under a key prefix (e.g.
`<prefix>/_system/`, `<prefix>/generated/`, `<prefix>/raw/`), but the task was
configured with `VAULT_PREFIX=""`. With an empty prefix the app looks at the
**bucket root** for `_system/index.md`, `generated/`, etc., finds nothing, and
correctly reports an empty vault.

**Fix:** set `VAULT_PREFIX` to the prefix your vault actually lives under.
Confirm the layout first:

```bash
aws s3api list-objects-v2 --bucket <bucket> --prefix "" --delimiter "/" \
  --query 'CommonPrefixes[].Prefix' --output text
# Then list one level deeper to find _system/, generated/, raw/, users/
aws s3api list-objects-v2 --bucket <bucket> --prefix "<prefix>/" --delimiter "/" \
  --query 'CommonPrefixes[].Prefix' --output text
```

A healthy vault has `<prefix>/_system/index.md` plus `generated/`, `raw/`, and
optionally `users/<id>/` directories.

### Other architecture pitfalls

- **Image arch must match `runtimePlatform.cpuArchitecture`.** An ARM64 image
  on an `X86_64` task definition (or vice versa) fails to start. Build with the
  matching `--platform`.
- **Bucket region vs run region can differ.** S3 ARNs are region-agnostic, so
  the task can run in one region while `VAULT_REGION` points at the bucket's
  actual region. Just make sure `VAULT_REGION` is correct.
