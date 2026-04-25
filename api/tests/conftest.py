import os

import boto3
import pytest
from moto import mock_aws

# Set required env vars before app imports resolve settings
os.environ.setdefault("VAULT_BUCKET", "test-bucket")
os.environ.setdefault("VAULT_PREFIX", "vault")
os.environ.setdefault("VAULT_REGION", "us-east-1")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x")


BUCKET = "test-bucket"
PREFIX = "vault"

INDEX_MD = """\
---
title: Index
type: nav
updated: 2026-05-03
---

- wiki/getting-started.md
- wiki/architecture.md
- wiki/ops/runbook.md
- wiki/ops/alerts.md
"""

DOCS: dict[str, str] = {
    "wiki/getting-started.md": "---\ntitle: Getting Started\n---\n# Getting Started\n\nHello.",
    "wiki/architecture.md": "---\ntitle: Architecture\n---\n# Architecture\n\nDiagram here.",
    "wiki/ops/runbook.md": "---\ntitle: Runbook\n---\n# Runbook\n\nSteps.",
    "wiki/ops/alerts.md": "---\ntitle: Alerts\n---\n# Alerts\n\nFiring.",
}


@pytest.fixture()
def s3_bucket():
    """Spin up a moto S3 bucket pre-populated with fixture docs."""
    with mock_aws():
        from app import s3
        from app.config import get_settings

        get_settings.cache_clear()
        s3.reset_client()

        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        client.put_object(Bucket=BUCKET, Key=f"{PREFIX}/index.md", Body=INDEX_MD.encode())
        for rel_key, body in DOCS.items():
            client.put_object(Bucket=BUCKET, Key=f"{PREFIX}/{rel_key}", Body=body.encode())
        yield client

        s3.reset_client()
        get_settings.cache_clear()
