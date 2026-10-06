from datetime import UTC, datetime, timedelta
from uuid import UUID

from shadowcoach_api.domain.entities import TrainingAttempt
from shadowcoach_api.domain.enums import AttemptStatus, Move
from shadowcoach_api.domain.exceptions import ConflictError, NotFoundError, ValidationError

from .dto import CreateAttemptCommand, CreatedAttempt
from .ports import UnitOfWorkFactory


class AttemptService:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    async def create(self, user_id: UUID, command: CreateAttemptCommand) -> CreatedAttempt:
        self._validate(command)
        async with self._uow_factory() as uow:
            existing = await uow.attempts.get_by_client_id(user_id, command.client_attempt_id)
            if existing:
                if not self._same_attempt(existing, command):
                    raise ConflictError("client_attempt_id is already used by another report")
                return CreatedAttempt(attempt_id=existing.id, created=False)
            attempt = TrainingAttempt(
                user_id=user_id,
                client_attempt_id=command.client_attempt_id,
                move=command.move,
                stance=command.stance,
                status=command.status,
                score=command.score,
                violations=command.violations,
                quality_issues=command.quality_issues,
                metrics=command.metrics,
                score_components=command.score_components,
                main_feedback=command.main_feedback,
                confidence_mode=command.confidence_mode,
                analyzer_version=command.analyzer_version,
                occurred_at=command.occurred_at,
            )
            await uow.attempts.add(attempt)
            await uow.commit()
            return CreatedAttempt(attempt_id=attempt.id, created=True)

    async def get(self, user_id: UUID, attempt_id: UUID) -> TrainingAttempt:
        async with self._uow_factory() as uow:
            attempt = await uow.attempts.get_by_id(user_id, attempt_id)
            if attempt is None:
                raise NotFoundError("Training attempt not found")
            return attempt

    async def list(
        self,
        user_id: UUID,
        *,
        move: Move | None,
        status: AttemptStatus | None,
        limit: int,
        offset: int,
    ) -> tuple[list[TrainingAttempt], int]:
        async with self._uow_factory() as uow:
            return await uow.attempts.list_for_user(
                user_id, move=move, status=status, limit=limit, offset=offset
            )

    async def delete(self, user_id: UUID, attempt_id: UUID) -> None:
        async with self._uow_factory() as uow:
            if not await uow.attempts.delete(user_id, attempt_id):
                raise NotFoundError("Training attempt not found")
            await uow.commit()

    @staticmethod
    def _validate(command: CreateAttemptCommand) -> None:
        completed = command.status is AttemptStatus.COMPLETED
        if completed != (command.score is not None):
            raise ValidationError("Only completed attempts can have a score")
        now = datetime.now(UTC)
        occurred = command.occurred_at.astimezone(UTC)
        if occurred > now + timedelta(minutes=5):
            raise ValidationError("occurred_at cannot be in the future")
        if occurred < now - timedelta(days=366):
            raise ValidationError("occurred_at is outside the accepted retention window")

    @staticmethod
    def _same_attempt(attempt: TrainingAttempt, command: CreateAttemptCommand) -> bool:
        return (
            attempt.move == command.move
            and attempt.stance == command.stance
            and attempt.status == command.status
            and attempt.score == command.score
            and attempt.analyzer_version == command.analyzer_version
        )
