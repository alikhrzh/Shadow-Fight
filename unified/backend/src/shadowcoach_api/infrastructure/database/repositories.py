from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shadowcoach_api.domain.entities import (
    ProgressRecord,
    RefreshSession,
    TrainingAttempt,
    User,
)
from shadowcoach_api.domain.enums import AttemptStatus, Move, Stance
from shadowcoach_api.domain.exceptions import ConflictError

from .models import RefreshSessionModel, TrainingAttemptModel, UserModel


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _user(model: UserModel) -> User:
    return User(
        id=model.id,
        email=model.email,
        password_hash=model.password_hash,
        display_name=model.display_name,
        is_active=model.is_active,
        created_at=_aware(model.created_at),
        updated_at=_aware(model.updated_at),
    )


def _refresh_session(model: RefreshSessionModel) -> RefreshSession:
    return RefreshSession(
        id=model.id,
        user_id=model.user_id,
        token_hash=model.token_hash,
        expires_at=_aware(model.expires_at),  # type: ignore[arg-type]
        created_at=_aware(model.created_at),
        revoked_at=_aware(model.revoked_at),
    )


def _attempt(model: TrainingAttemptModel) -> TrainingAttempt:
    return TrainingAttempt(
        id=model.id,
        user_id=model.user_id,
        client_attempt_id=model.client_attempt_id,
        move=Move(model.move),
        stance=Stance(model.stance),
        status=AttemptStatus(model.status),
        score=model.score,
        violations=model.violations,
        quality_issues=model.quality_issues,
        metrics=model.metrics,
        score_components=model.score_components,
        main_feedback=model.main_feedback,
        confidence_mode=model.confidence_mode,
        analyzer_version=model.analyzer_version,
        occurred_at=_aware(model.occurred_at),  # type: ignore[arg-type]
        created_at=_aware(model.created_at),
    )


class SqlAlchemyUserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: UUID) -> User | None:
        model = await self._session.get(UserModel, user_id)
        return _user(model) if model else None

    async def get_by_email(self, email: str) -> User | None:
        model = await self._session.scalar(select(UserModel).where(UserModel.email == email))
        return _user(model) if model else None

    async def add(self, user: User) -> None:
        now = datetime.now(UTC)
        model = UserModel(
            id=user.id,
            email=user.email,
            password_hash=user.password_hash,
            display_name=user.display_name,
            is_active=user.is_active,
            created_at=now,
            updated_at=now,
        )
        self._session.add(model)
        try:
            await self._session.flush()
        except IntegrityError as exc:
            raise ConflictError("An account with this email already exists") from exc
        user.created_at = now
        user.updated_at = now


class SqlAlchemyRefreshSessionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, refresh: RefreshSession) -> None:
        now = datetime.now(UTC)
        self._session.add(
            RefreshSessionModel(
                id=refresh.id,
                user_id=refresh.user_id,
                token_hash=refresh.token_hash,
                expires_at=refresh.expires_at,
                created_at=now,
                revoked_at=refresh.revoked_at,
            )
        )
        await self._session.flush()
        refresh.created_at = now

    async def consume(self, token_hash: str, now: datetime) -> RefreshSession | None:
        model = await self._session.scalar(
            select(RefreshSessionModel).where(
                RefreshSessionModel.token_hash == token_hash,
                RefreshSessionModel.revoked_at.is_(None),
                RefreshSessionModel.expires_at > now,
            )
        )
        if model is None:
            return None
        result = await self._session.execute(
            update(RefreshSessionModel)
            .where(
                RefreshSessionModel.id == model.id,
                RefreshSessionModel.revoked_at.is_(None),
                RefreshSessionModel.expires_at > now,
            )
            .values(revoked_at=now)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            return None
        model.revoked_at = now
        return _refresh_session(model)

    async def revoke_by_hash(self, token_hash: str, now: datetime) -> bool:
        result = await self._session.execute(
            update(RefreshSessionModel)
            .where(
                RefreshSessionModel.token_hash == token_hash,
                RefreshSessionModel.revoked_at.is_(None),
            )
            .values(revoked_at=now)
            .execution_options(synchronize_session=False)
        )
        return result.rowcount > 0

    async def revoke_all_for_user(self, user_id: UUID, now: datetime) -> int:
        result = await self._session.execute(
            update(RefreshSessionModel)
            .where(
                RefreshSessionModel.user_id == user_id,
                RefreshSessionModel.revoked_at.is_(None),
            )
            .values(revoked_at=now)
            .execution_options(synchronize_session=False)
        )
        return result.rowcount


class SqlAlchemyTrainingAttemptRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, attempt: TrainingAttempt) -> None:
        now = datetime.now(UTC)
        self._session.add(
            TrainingAttemptModel(
                id=attempt.id,
                user_id=attempt.user_id,
                client_attempt_id=attempt.client_attempt_id,
                move=attempt.move.value,
                stance=attempt.stance.value,
                status=attempt.status.value,
                score=attempt.score,
                violations=attempt.violations,
                quality_issues=attempt.quality_issues,
                metrics=attempt.metrics,
                score_components=attempt.score_components,
                main_feedback=attempt.main_feedback,
                confidence_mode=attempt.confidence_mode,
                analyzer_version=attempt.analyzer_version,
                occurred_at=attempt.occurred_at,
                created_at=now,
            )
        )
        try:
            await self._session.flush()
        except IntegrityError as exc:
            raise ConflictError("Training attempt already exists") from exc
        attempt.created_at = now

    async def get_by_id(self, user_id: UUID, attempt_id: UUID) -> TrainingAttempt | None:
        model = await self._session.scalar(
            select(TrainingAttemptModel).where(
                TrainingAttemptModel.id == attempt_id,
                TrainingAttemptModel.user_id == user_id,
            )
        )
        return _attempt(model) if model else None

    async def get_by_client_id(
        self, user_id: UUID, client_attempt_id: UUID
    ) -> TrainingAttempt | None:
        model = await self._session.scalar(
            select(TrainingAttemptModel).where(
                TrainingAttemptModel.user_id == user_id,
                TrainingAttemptModel.client_attempt_id == client_attempt_id,
            )
        )
        return _attempt(model) if model else None

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        move: Move | None,
        status: AttemptStatus | None,
        limit: int,
        offset: int,
    ) -> tuple[list[TrainingAttempt], int]:
        filters = [TrainingAttemptModel.user_id == user_id]
        if move is not None:
            filters.append(TrainingAttemptModel.move == move.value)
        if status is not None:
            filters.append(TrainingAttemptModel.status == status.value)
        total = await self._session.scalar(
            select(func.count()).select_from(TrainingAttemptModel).where(*filters)
        )
        rows = await self._session.scalars(
            select(TrainingAttemptModel)
            .where(*filters)
            .order_by(TrainingAttemptModel.occurred_at.desc(), TrainingAttemptModel.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return [_attempt(row) for row in rows], int(total or 0)

    async def delete(self, user_id: UUID, attempt_id: UUID) -> bool:
        result = await self._session.execute(
            delete(TrainingAttemptModel)
            .where(
                TrainingAttemptModel.id == attempt_id,
                TrainingAttemptModel.user_id == user_id,
            )
            .execution_options(synchronize_session=False)
        )
        return result.rowcount > 0

    async def progress_records(self, user_id: UUID) -> list[ProgressRecord]:
        rows = await self._session.execute(
            select(
                TrainingAttemptModel.id,
                TrainingAttemptModel.move,
                TrainingAttemptModel.score,
                TrainingAttemptModel.violations,
                TrainingAttemptModel.occurred_at,
            )
            .where(
                TrainingAttemptModel.user_id == user_id,
                TrainingAttemptModel.status == AttemptStatus.COMPLETED.value,
                TrainingAttemptModel.score.is_not(None),
            )
            .order_by(TrainingAttemptModel.occurred_at, TrainingAttemptModel.id)
        )
        return [
            ProgressRecord(
                attempt_id=row.id,
                move=Move(row.move),
                score=row.score,
                violations=row.violations,
                occurred_at=_aware(row.occurred_at),  # type: ignore[arg-type]
            )
            for row in rows
        ]
