import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import mem_search
from app.db.session import get_session
from app.models import SearchResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=list[SearchResult])
async def search(
    q: Annotated[str, Query(min_length=1)],
    session: AsyncSession = Depends(get_session),
) -> list[SearchResult]:
    # Try Postgres FTS first; fall back to in-memory fuzzy search if DB unavailable.
    try:
        from app.config import get_settings
        vault_id = get_settings().vault_id
        rows = await session.execute(
            text("""
                SELECT id, title, path,
                       ts_headline('english', body_text, plainto_tsquery('english', :q),
                                   'MaxWords=20, MinWords=10') AS snippet,
                       ts_rank(to_tsvector('english', title || ' ' || body_text),
                               plainto_tsquery('english', :q)) AS rank
                FROM documents
                WHERE vault_id = :vault_id
                  AND to_tsvector('english', title || ' ' || body_text)
                      @@ plainto_tsquery('english', :q)
                ORDER BY rank DESC
                LIMIT 20
            """),
            {"q": q, "vault_id": vault_id},
        )
        results = [
            SearchResult(id=r.id, title=r.title, path=r.path, snippet=r.snippet, rank=float(r.rank))
            for r in rows
        ]
        if results:
            return results
        # Postgres returned nothing — fall through to fuzzy search
    except Exception:
        logger.debug("Postgres search unavailable, using in-memory fuzzy search")

    hits = mem_search.search(q)
    return [
        SearchResult(id=h["id"], title=h["title"], path=h["path"],
                     snippet=h["snippet"], rank=h["rank"])
        for h in hits
    ]
