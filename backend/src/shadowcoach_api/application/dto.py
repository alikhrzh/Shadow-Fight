from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from shadowcoach_api.domain.enums import AttemptStatus, Move, Stance


@dataclass(frozen=True, slots=True)
class RegisterCommand:
    email: str
    password: str
    display_name: str


@dataclass(frozen=True, slots=True)
class LoginCommand:
    email: str
    password: str


@dataclass(frozen=True, slots=True)
class AuthResult:
    access_token: str
    access_expires_in: int
    refresh_token: str
    refresh_expires_at: datetime
    user_id: UUID


@dataclass(frozen=True, slots=True)
class CreateAttemptCommand:
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
    confidence_mode: str | None
    analyzer_version: str
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class CreatedAttempt:
    attempt_id: UUID
    created: bool
