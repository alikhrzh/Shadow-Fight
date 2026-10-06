import math
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from shadowcoach_api.application.dto import CreateAttemptCommand
from shadowcoach_api.domain.entities import MoveProgress, ProgressRecord, TrainingAttempt, User
from shadowcoach_api.domain.enums import AttemptStatus, Move, Stance

StrictText = Annotated[str, StringConstraints(strip_whitespace=True)]

VIOLATION_CODES = {
    "wrong_hand",
    "guard_dropped",
    "insufficient_extension",
    "low_amplitude",
    "no_shoulder_rotation",
    "elbow_too_straight",
    "elbow_too_bent",
    "elbow_too_low",
    "trajectory_not_straight",
    "trajectory_too_straight",
    "not_returned_to_guard",
    "timing_out_of_range",
}
QUALITY_CODES = {
    "person_not_detected",
    "multiple_people",
    "wrist_not_visible",
    "body_out_of_frame",
    "video_too_short",
    "low_pose_quality",
    "no_attempt_detected",
    "guard_not_found",
    "hook_peak_ambiguous",
    "ambiguous_attempt",
}
METRIC_KEYS = {
    "duration_ms",
    "max_wrist_speed",
    "wrist_displacement",
    "horizontal_displacement",
    "medial_displacement",
    "vertical_displacement",
    "depth_displacement",
    "elbow_angle_start",
    "elbow_angle_peak",
    "elbow_angle_range",
    "max_elbow_angle",
    "other_hand_guard_distance_max",
    "other_hand_guard_distance_mean",
    "guard_distance_peak",
    "shoulder_rotation",
    "elbow_shoulder_vertical_gap",
    "trajectory_straightness",
    "return_distance",
    "active_hand",
    "expected_hand",
    "returned_to_guard",
    "angle_coordinate_space",
    "rotation_coordinate_space",
    "motion_coordinate_space",
}
SCALAR_METRIC_KEYS = METRIC_KEYS - {
    "active_hand",
    "expected_hand",
    "returned_to_guard",
    "angle_coordinate_space",
    "rotation_coordinate_space",
    "motion_coordinate_space",
}
COMPONENT_KEYS = {
    "completion",
    "return",
    "extension",
    "elbow_form",
    "guard",
    "trajectory",
    "rotation",
    "elbow_height",
}
JOINTS = {
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
}


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class RegisterRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: StrictText = Field(min_length=1, max_length=80)


class LoginRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(ApiModel):
    id: UUID
    email: EmailStr
    display_name: str
    created_at: datetime

    @classmethod
    def from_domain(cls, user: User) -> "UserResponse":
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            created_at=user.created_at,
        )


class AuthResponse(ApiModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserResponse


class SessionStatusResponse(ApiModel):
    refresh_cookie_present: bool


class ViolationInput(ApiModel):
    code: str
    severity: float = Field(ge=0, le=1)
    related_joints: list[str] = Field(default_factory=list, max_length=7)

    @field_validator("code")
    @classmethod
    def known_code(cls, value: str) -> str:
        if value not in VIOLATION_CODES:
            raise ValueError("unknown violation code")
        return value

    @field_validator("related_joints")
    @classmethod
    def known_joints(cls, value: list[str]) -> list[str]:
        if any(joint not in JOINTS for joint in value):
            raise ValueError("unknown related joint")
        return value


class QualityIssueInput(ApiModel):
    code: str
    related_joints: list[str] = Field(default_factory=list, max_length=7)

    @field_validator("code")
    @classmethod
    def known_code(cls, value: str) -> str:
        if value not in QUALITY_CODES:
            raise ValueError("unknown quality issue code")
        return value

    @field_validator("related_joints")
    @classmethod
    def known_joints(cls, value: list[str]) -> list[str]:
        if any(joint not in JOINTS for joint in value):
            raise ValueError("unknown related joint")
        return value


class AttemptCreateRequest(ApiModel):
    client_attempt_id: UUID
    move: Move
    stance: Stance
    status: AttemptStatus
    score: int | None = Field(default=None, ge=0, le=100)
    violations: list[ViolationInput] = Field(default_factory=list, max_length=5)
    quality_issues: list[QualityIssueInput] = Field(default_factory=list, max_length=10)
    metrics: dict[str, Any] | None = None
    score_components: dict[str, float] = Field(default_factory=dict)
    main_feedback: StrictText = Field(min_length=1, max_length=500)
    confidence_mode: Literal["visibility_only_web", "presence_and_visibility"] | None = None
    analyzer_version: StrictText = Field(min_length=1, max_length=40)
    occurred_at: datetime

    @field_validator("occurred_at")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("occurred_at must include a timezone")
        return value

    @field_validator("metrics")
    @classmethod
    def safe_metrics(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        if len(value) > len(METRIC_KEYS) or any(key not in METRIC_KEYS for key in value):
            raise ValueError("metrics contain unknown fields")
        for key in SCALAR_METRIC_KEYS:
            if key not in value or value[key] is None:
                continue
            metric = value[key]
            if (
                isinstance(metric, bool)
                or not isinstance(metric, (int, float))
                or not math.isfinite(metric)
                or not -100_000 <= metric <= 100_000
            ):
                raise ValueError(f"{key} must be a finite numeric value")
        for key in ("active_hand", "expected_hand"):
            if key in value and value[key] not in {"left", "right"}:
                raise ValueError(f"{key} must be left or right")
        if "returned_to_guard" in value and not isinstance(value["returned_to_guard"], bool):
            raise ValueError("returned_to_guard must be a boolean")
        if "angle_coordinate_space" in value and value["angle_coordinate_space"] not in {
            "world_3d",
            "image_2d",
        }:
            raise ValueError("invalid angle coordinate space")
        if "rotation_coordinate_space" in value and value["rotation_coordinate_space"] not in {
            None,
            "world_3d",
        }:
            raise ValueError("invalid rotation coordinate space")
        if "motion_coordinate_space" in value and value["motion_coordinate_space"] != (
            "aspect_corrected_image_2d"
        ):
            raise ValueError("invalid motion coordinate space")
        return value

    @field_validator("score_components")
    @classmethod
    def safe_components(cls, value: dict[str, float]) -> dict[str, float]:
        if any(key not in COMPONENT_KEYS for key in value):
            raise ValueError("score_components contain unknown fields")
        if any(not math.isfinite(score) or score < 0 or score > 1 for score in value.values()):
            raise ValueError("score components must be between 0 and 1")
        return value

    @model_validator(mode="after")
    def status_consistency(self) -> "AttemptCreateRequest":
        if self.status is AttemptStatus.COMPLETED:
            if self.score is None or self.metrics is None:
                raise ValueError("completed attempts require score and metrics")
            if self.quality_issues:
                raise ValueError("completed attempts cannot contain quality issues")
        elif self.score is not None:
            raise ValueError("unreliable and no_attempt reports cannot contain a score")
        return self

    def to_command(self) -> CreateAttemptCommand:
        return CreateAttemptCommand(
            client_attempt_id=self.client_attempt_id,
            move=self.move,
            stance=self.stance,
            status=self.status,
            score=self.score,
            violations=[item.model_dump(mode="json") for item in self.violations],
            quality_issues=[item.model_dump(mode="json") for item in self.quality_issues],
            metrics=self.metrics,
            score_components=self.score_components,
            main_feedback=self.main_feedback,
            confidence_mode=self.confidence_mode,
            analyzer_version=self.analyzer_version,
            occurred_at=self.occurred_at,
        )


class AttemptResponse(ApiModel):
    id: UUID
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
    created_at: datetime

    @classmethod
    def from_domain(cls, attempt: TrainingAttempt) -> "AttemptResponse":
        return cls.model_validate(attempt)


class AttemptCreatedResponse(ApiModel):
    created: bool
    attempt: AttemptResponse


class AttemptPageResponse(ApiModel):
    items: list[AttemptResponse]
    total: int
    limit: int
    offset: int


class MoveProgressResponse(ApiModel):
    move: Move
    count: int
    last_score: int | None
    best_score: int | None
    average_score: float | None
    previous_score: int | None
    trend: int | None
    last_practiced_at: datetime | None
    common_violations: list[str]

    @classmethod
    def from_domain(cls, progress: MoveProgress) -> "MoveProgressResponse":
        return cls(
            move=progress.move,
            count=progress.count,
            last_score=progress.last_score,
            best_score=progress.best_score,
            average_score=progress.average_score,
            previous_score=progress.previous_score,
            trend=progress.trend,
            last_practiced_at=progress.last_practiced_at,
            common_violations=list(progress.common_violations),
        )


class ProgressSummaryResponse(ApiModel):
    reliable_attempts: int
    moves: list[MoveProgressResponse]


class ProgressPointResponse(ApiModel):
    attempt_id: UUID
    move: Move
    score: int
    occurred_at: datetime

    @classmethod
    def from_domain(cls, point: ProgressRecord) -> "ProgressPointResponse":
        return cls(
            attempt_id=point.attempt_id,
            move=point.move,
            score=point.score,
            occurred_at=point.occurred_at,
        )


class ErrorResponse(ApiModel):
    detail: str
