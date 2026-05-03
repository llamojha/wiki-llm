from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

# Engine and factory are module-level singletons — creating them per-request
# would defeat connection pooling. Initialized lazily on first use so tests
# can set env vars before the engine is created.
_engine = None
_factory: async_sessionmaker[AsyncSession] | None = None


def _get_factory() -> async_sessionmaker[AsyncSession]:
    global _engine, _factory
    if _factory is None:
        _engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
        _factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _factory


def reset_session_factory() -> None:
    """Force re-creation of engine + factory — used in tests."""
    global _engine, _factory
    _engine = None
    _factory = None


async def get_session() -> AsyncGenerator[AsyncSession]:
    async with _get_factory()() as session:
        yield session
