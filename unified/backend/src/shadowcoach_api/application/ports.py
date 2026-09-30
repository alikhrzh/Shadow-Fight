from contextlib import AbstractAsyncContextManager
from datetime import datetime
from typing import Protocol
from uuid import UUID

from shadowcoach_api.domain.repositories import (
    RefreshSessionRepository,
    TrainingAttemptRepository,
    UserRepository,
)


class PasswordService(Protocol):
    def hash(self, password: str) -> str: ...

    def verify(self, password: str, password_hash: str) -> bool: ...

    def verify_dummy(self, password: str) -> None: ...


class AccessTokenService(Protocol):
    def create(self, user_id: UUID, now: datetime) -> tuple[str, int]: ...

    def decode(self, token: str) -> UUID: ...


class RefreshTokenService(Protocol):
    def create(self) -> str: ...

    def hash(self, token: str) -> str: ...


class UnitOfWork(AbstractAsyncContextManager["UnitOfWork"], Protocol):
    users: UserRepository
    refresh_sessions: RefreshSessionRepository
    attempts: TrainingAttemptRepository

    async def commit(self) -> None: ...

    async def rollback(self) -> None: ...


class UnitOfWorkFactory(Protocol):
    def __call__(self) -> UnitOfWork: ...
