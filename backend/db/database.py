"""Async SQLAlchemy engine/session setup.

Two access patterns are exposed:
  - get_db(): FastAPI dependency for non-streaming request handlers. Session
    lifetime is tied to the response.
  - session_scope(): a plain async context manager for use in agent tools
    and the seed script, where we deliberately want a short-lived session
    per call rather than one held for an entire SSE-streamed request (see
    plan notes on why streaming endpoints don't use Depends(get_db)).
"""

from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config.settings import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    pool_size=settings.db_pool_size,
    max_overflow=10,
    pool_pre_ping=True,  # Supabase's pooler drops idle connections
    pool_recycle=1800,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session
