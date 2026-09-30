from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .repositories import (
    SqlAlchemyRefreshSessionRepository,
    SqlAlchemyTrainingAttemptRepository,
    SqlAlchemyUserRepository,
)


class SqlAlchemyUnitOfWork:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def __aenter__(self) -> "SqlAlchemyUnitOfWork":
        self._session = self._session_factory()
        self.users = SqlAlchemyUserRepository(self._session)
        self.refresh_sessions = SqlAlchemyRefreshSessionRepository(self._session)
        self.attempts = SqlAlchemyTrainingAttemptRepository(self._session)
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        if exc_type is not None:
            await self._session.rollback()
        await self._session.close()

    async def commit(self) -> None:
        await self._session.commit()

    async def rollback(self) -> None:
        await self._session.rollback()


class SqlAlchemyUnitOfWorkFactory:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    def __call__(self) -> SqlAlchemyUnitOfWork:
        return SqlAlchemyUnitOfWork(self._session_factory)
