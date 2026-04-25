"""Index vault documents from S3 into Postgres for full-text search."""
from __future__ import annotations

import asyncio
import json
import logging
import re

import frontmatter
from sqlalchemy.ext.asyncio import AsyncSession

from app import s3
from app.config import get_settings
from app.db.models import Document
from app.utils import compute_checksum

logger = logging.getLogger(__name__)

_SKIP = {"index.md", "log.md"}
_FETCH_CONCURRENCY = 10


def _strip_markdown(raw: str) -> str:
    """Very lightweight Markdown → plain text for FTS indexing."""
    if raw.startswith("---"):
        end = raw.find("---", 3)
        if end != -1:
            raw = raw[end + 3:]
    raw = re.sub(r"```.*?```", " ", raw, flags=re.DOTALL)
    raw = re.sub(r"`[^`]+`", " ", raw)
    raw = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", raw)
    raw = re.sub(r"[#*_~>|]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _build_document(key: str, raw: str, cfg) -> Document:  # type: ignore[no-untyped-def]
    post = frontmatter.loads(raw)
    fm = post.metadata
    title = str(fm.get("title") or _key_to_title(key))
    author = str(fm.get("author") or "")
    updated = str(fm.get("updated") or "")
    tags_raw = fm.get("tags", [])
    tags = list(tags_raw) if isinstance(tags_raw, list) else [str(tags_raw)]
    source_type = "generated" if key.startswith("generated/") else "authored"
    path = " / ".join(key.removesuffix(".md").split("/"))
    s3_key = (cfg.vault_prefix + "/" + key).lstrip("/") if cfg.vault_prefix else key
    return Document(
        id=key,
        vault_id=cfg.vault_id,
        s3_key=s3_key,
        title=title,
        path=path,
        source_type=source_type,
        updated=updated,
        author=author,
        tags=json.dumps(tags),
        checksum=compute_checksum(raw),
        body_text=_strip_markdown(raw),
    )


async def index_vault(session: AsyncSession) -> None:
    cfg = get_settings()
    # list_objects is synchronous boto3 — run in thread to avoid blocking event loop
    keys = [k for k in await asyncio.to_thread(s3.list_objects) if k not in _SKIP]
    logger.info("Indexing %d documents for vault %s", len(keys), cfg.vault_id)

    sem = asyncio.Semaphore(_FETCH_CONCURRENCY)

    async def fetch(key: str) -> tuple[str, str] | None:
        async with sem:
            try:
                raw = await asyncio.to_thread(s3.get_object, key)
                return key, raw
            except Exception:
                logger.warning("Skipping %s — failed to fetch", key)
                return None

    results = await asyncio.gather(*[fetch(k) for k in keys])

    for result in results:
        if result is None:
            continue
        key, raw = result
        await session.merge(_build_document(key, raw, cfg))

    await session.commit()
    logger.info("Indexed %d documents", len(keys))


def _key_to_title(key: str) -> str:
    stem = key.rsplit("/", 1)[-1].removesuffix(".md")
    return re.sub(r"[-_]+", " ", stem).title()
