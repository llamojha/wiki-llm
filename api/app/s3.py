from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.config import get_settings

_client_cache: Any = None


def _client() -> Any:
    global _client_cache
    if _client_cache is None:
        cfg = get_settings()
        kwargs: dict = {"region_name": cfg.vault_region}
        if cfg.aws_access_key_id:
            kwargs["aws_access_key_id"] = cfg.aws_access_key_id
            kwargs["aws_secret_access_key"] = cfg.aws_secret_access_key
        if cfg.aws_endpoint_url:
            kwargs["endpoint_url"] = cfg.aws_endpoint_url
        _client_cache = boto3.client("s3", **kwargs)
    return _client_cache


def reset_client() -> None:
    """Force client re-creation — used in tests when moto context changes."""
    global _client_cache
    _client_cache = None


def list_objects(prefix: str = "") -> list[str]:
    """Return all .md keys under the vault prefix (+ optional sub-prefix)."""
    cfg = get_settings()
    client = _client()
    if prefix:
        full_prefix = (cfg.vault_prefix + "/" + prefix).lstrip("/")
    else:
        full_prefix = cfg.vault_prefix
    paginator = client.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=cfg.vault_bucket, Prefix=full_prefix):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]
            rel = key.removeprefix(cfg.vault_prefix).lstrip("/")
            if rel.endswith(".md"):
                keys.append(rel)
    return keys


def get_object(key: str) -> str:
    """Fetch a single object by relative key and return its content as a string."""
    cfg = get_settings()
    client = _client()
    full_key = (cfg.vault_prefix + "/" + key).lstrip("/") if cfg.vault_prefix else key
    try:
        resp = client.get_object(Bucket=cfg.vault_bucket, Key=full_key)
        return resp["Body"].read().decode("utf-8")
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("NoSuchKey", "404"):
            raise KeyError(key) from exc
        raise
