from datetime import datetime
from typing import Protocol
from uuid import UUID

from .entities import ProgressRecord, RefreshSession, TrainingAttempt, User
from .enums import AttemptStatus, Move


class UserRepository(Protocol):
    async def get_by_id(self, user_id: UUID) -> User | None: ...

    async def get_by_email(self, email: str) -> User | None: ...

    async def add(self, user: User) -> None: ...


class RefreshSessionRepository(Protocol):
    async def add(self, session: RefreshSession) -> None: ...

    async def consume(self, token_hash: str, now: datetime) -> RefreshSession | None: ...

    async def revoke_by_hash(self, token_hash: str, now: datetime) -> bool: ...

    async def revoke_all_for_user(self, user_id: UUID, now: datetime) -> int: ...


class TrainingAttemptRepository(Protocol):
    async def add(self, attempt: TrainingAttempt) -> None: ...

    async def get_by_id(self, user_id: UUID, attempt_id: UUID) -> TrainingAttempt | None: ...

    async def get_by_client_id(
        self, user_id: UUID, client_attempt_id: UUID
    ) -> TrainingAttempt | None: ...

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        move: Move | None,
        status: AttemptStatus | None,
        limit: int,
        offset: int,
    ) -> tuple[list[TrainingAttempt], int]: ...

    async def delete(self, user_id: UUID, attempt_id: UUID) -> bool: ...

    async def progress_records(self, user_id: UUID) -> list[ProgressRecord]: ...
