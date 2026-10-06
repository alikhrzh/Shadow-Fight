from collections import Counter
from uuid import UUID

from shadowcoach_api.domain.entities import MoveProgress, ProgressRecord
from shadowcoach_api.domain.enums import Move

from .ports import UnitOfWorkFactory


class ProgressService:
    def __init__(self, uow_factory: UnitOfWorkFactory) -> None:
        self._uow_factory = uow_factory

    async def summary(self, user_id: UUID) -> list[MoveProgress]:
        async with self._uow_factory() as uow:
            records = await uow.attempts.progress_records(user_id)
        grouped = {move: [] for move in Move}
        for record in records:
            grouped[record.move].append(record)
        return [self._summarize(move, grouped[move]) for move in Move]

    async def timeline(self, user_id: UUID, move: Move | None, limit: int) -> list[ProgressRecord]:
        async with self._uow_factory() as uow:
            records = await uow.attempts.progress_records(user_id)
        if move is not None:
            records = [record for record in records if record.move is move]
        return records[-limit:]

    @staticmethod
    def _summarize(move: Move, records: list[ProgressRecord]) -> MoveProgress:
        if not records:
            return MoveProgress(
                move=move,
                count=0,
                last_score=None,
                best_score=None,
                average_score=None,
                previous_score=None,
                trend=None,
                last_practiced_at=None,
                common_violations=(),
            )
        scores = [record.score for record in records]
        issues = Counter(
            str(violation["code"])
            for record in records[-20:]
            for violation in record.violations
            if isinstance(violation.get("code"), str)
        )
        previous = scores[-2] if len(scores) > 1 else None
        return MoveProgress(
            move=move,
            count=len(scores),
            last_score=scores[-1],
            best_score=max(scores),
            average_score=round(sum(scores) / len(scores), 2),
            previous_score=previous,
            trend=scores[-1] - previous if previous is not None else None,
            last_practiced_at=records[-1].occurred_at,
            common_violations=tuple(code for code, _ in issues.most_common(3)),
        )
