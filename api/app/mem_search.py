"""In-memory fuzzy search index built from vault docs.

Loaded on startup from index.md + S3 doc fetches.
Used as a fallback when Postgres is unavailable, and as the primary
search backend for small vaults (< ~100 docs).
"""
from __future__ import annotations

import asyncio
import logging
import re

import frontmatter
from rapidfuzz import fuzz

from app import s3

logger = logging.getLogger(__name__)

type IndexEntry = dict  # {id, title, path, snippet}

_index: list[IndexEntry] = []


def _extract_snippet(raw: str, max_chars: int = 200) -> str:
    """Return the first non-empty paragraph of body text."""
    # Strip frontmatter
    if raw.startswith("---"):
        end = raw.find("---", 3)
        if end != -1:
            raw = raw[end + 3:]
    # Strip Markdown syntax and grab first meaningful text
    text = re.sub(r"[#*_`>\[\]!|~]+", " ", raw)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


async def build_index() -> None:
    """Fetch docs listed in index.md and build the in-memory search index."""
    global _index
    try:
        raw_index = await asyncio.to_thread(s3.get_object, "index.md")
    except KeyError:
        logger.warning("index.md not found — in-memory search index is empty")
        return

    post = frontmatter.loads(raw_index)
    keys = [
        m.group(1).strip()
        for line in post.content.splitlines()
        if (m := re.match(r"^\s*[-*]\s+(.+\.md)\s*$", line))
    ]

    sem = asyncio.Semaphore(10)

    async def fetch(key: str) -> IndexEntry | None:
        async with sem:
            try:
                raw = await asyncio.to_thread(s3.get_object, key)
                fm = frontmatter.loads(raw).metadata
                title = str(fm.get("title") or _key_to_title(key))
                path = " / ".join(key.removesuffix(".md").split("/"))
                return {"id": key, "title": title, "path": path, "snippet": _extract_snippet(raw)}
            except Exception:
                logger.warning("Skipping %s from search index", key)
                return None

    results = await asyncio.gather(*[fetch(k) for k in keys])
    _index = [r for r in results if r is not None]
    logger.info("In-memory search index built: %d entries", len(_index))


def search(q: str, limit: int = 20) -> list[dict]:
    """Fuzzy search the in-memory index. Returns results sorted by score desc."""
    if not q.strip() or not _index:
        return []

    scored = []
    for entry in _index:
        # Title match weighted 2x over snippet match
        title_score = fuzz.partial_ratio(q.lower(), entry["title"].lower())
        snippet_score = fuzz.partial_ratio(q.lower(), entry["snippet"].lower())
        score = title_score * 2 + snippet_score
        if score > 120:  # threshold: at least a weak title match or strong snippet match
            scored.append({**entry, "rank": round(score / 300, 4)})

    scored.sort(key=lambda x: x["rank"], reverse=True)
    return scored[:limit]


def _key_to_title(key: str) -> str:
    stem = key.rsplit("/", 1)[-1].removesuffix(".md")
    return re.sub(r"[-_]+", " ", stem).title()
