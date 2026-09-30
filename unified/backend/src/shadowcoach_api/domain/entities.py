from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from .enums import AttemptStatus, Move, Stance


@dataclass(slots=True)
class User:
    email: str
    password_hash: str
    display_name: str
    id: UUID = field(default_factory=uuid4)
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class RefreshSession:
    user_id: UUID
    token_hash: str
    expires_at: datetime
    id: UUID = field(default_factory=uuid4)
    created_at: datetime | None = None
    revoked_at: datetime | None = None


@dataclass(slots=True)
class TrainingAttempt:
    user_id: UUID
    client_attempt_id: UUID
    move: Move
    stance: Stance
    status: AttemptStatus
    score: int | None
    violations: list[dict[str, Any]]
    quality_issues: list[dict[str, Any]]
    metrics: dict[str, Any] | None
    score_components: dict[str, float]
    main_feedback: str
    analyzer_version: str
    occurred_at: datetime
    id: UUID = field(default_factory=uuid4)
    confidence_mode: str | None = None
    created_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ProgressRecord:
    attempt_id: UUID
    move: Move
    score: int
    violations: list[dict[str, Any]]
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class MoveProgress:
    move: Move
    count: int
    last_score: int | None
    best_score: int | None
    average_score: float | None
    previous_score: int | None
    trend: int | None
    last_practiced_at: datetime | None
    common_violations: tuple[str, ...]
