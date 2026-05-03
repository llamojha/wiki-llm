import asyncio
import re
from urllib.parse import unquote

import frontmatter
from fastapi import APIRouter, HTTPException

from app import s3
from app.config import get_settings
from app.models import DocResponse
from app.utils import compute_checksum

router = APIRouter(prefix="/docs", tags=["docs"])


def _key_to_title(key: str) -> str:
    stem = key.rsplit("/", 1)[-1].removesuffix(".md")
    return re.sub(r"[-_]+", " ", stem).title()


def _infer_source_type(key: str) -> str:
    return "generated" if key.startswith("generated/") else "authored"


def _parse_doc(key: str, raw: str) -> DocResponse:
    post = frontmatter.loads(raw)
    fm = post.metadata

    title = str(fm.get("title") or _key_to_title(key))
    author = str(fm.get("author") or "unknown")
    updated = str(fm.get("updated") or "")
    tags_raw = fm.get("tags", [])
    tags = list(tags_raw) if isinstance(tags_raw, list) else [str(tags_raw)]
    source_type = str(fm.get("source_type") or _infer_source_type(key))
    path = " / ".join(key.removesuffix(".md").split("/"))

    cfg = get_settings()
    s3_key = (cfg.vault_prefix + "/" + key).lstrip("/") if cfg.vault_prefix else key

    return DocResponse(
        id=key,
        title=title,
        path=path,
        s3_key=s3_key,
        source_type=source_type,
        updated=updated,
        author=author,
        tags=tags,
        checksum=compute_checksum(raw),
        raw_markdown=raw,
    )


@router.get("/{doc_id:path}", response_model=DocResponse)
async def get_doc(doc_id: str) -> DocResponse:
    key = unquote(doc_id)
    try:
        raw = await asyncio.to_thread(s3.get_object, key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Document not found: {key}")
    return _parse_doc(key, raw)
