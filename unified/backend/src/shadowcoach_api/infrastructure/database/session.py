from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool


def create_database(
    database_url: str,
) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    options: dict = {"pool_pre_ping": True}
    if database_url in {"sqlite+aiosqlite://", "sqlite+aiosqlite:///:memory:"}:
        options["poolclass"] = StaticPool
        options["connect_args"] = {"check_same_thread": False}
    engine = create_async_engine(database_url, **options)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    return engine, sessions
