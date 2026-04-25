import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import docs, search, vaults

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Kick off vault indexing and in-memory search index build on startup."""
    from app import mem_search
    from app.db.session import _get_factory
    from app.indexer import index_vault

    async def _run_db() -> None:
        async with _get_factory()() as session:
            try:
                await index_vault(session)
            except Exception:
                logger.exception("Background DB indexing failed — search may be stale")

    asyncio.create_task(_run_db())
    asyncio.create_task(mem_search.build_index())
    yield


app = FastAPI(title="Vaultmark API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(vaults.router)
app.include_router(docs.router)
app.include_router(search.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
