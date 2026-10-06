from typing import Any

from pydantic import Field, model_validator

from shadowcoach import __version__
from shadowcoach.domain.enums import Move, Stance, Status
from shadowcoach.domain.models import (
    AttemptFeatures,
    Phases,
    PoseQuality,
    Schema,
    VideoInfo,
    Violation,
)


class Report(Schema):
    version: str = "1.0"
    software_version: str = __version__
    video: str
    expected_move: Move
    stance: Stance
    status: Status
    pose_quality: str
    quality: PoseQuality
    attempt_detected: bool = False
    peak_method: str | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    main_feedback: str
    violations: list[Violation] = Field(default_factory=list)
    metrics: AttemptFeatures | None = None
    phases: Phases = Field(default_factory=Phases)
    score_components: dict[str, float] = Field(default_factory=dict)
    effective_weights: dict[str, float] = Field(default_factory=dict)
    video_info: VideoInfo | None = None
    warnings: list[str] = Field(default_factory=list)
    configuration: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def score_requires_reliable_attempt(self) -> "Report":
        if self.status != Status.COMPLETED and (self.score is not None or self.violations):
            raise ValueError("Ненадёжные данные не могут иметь оценку или ошибки техники")
        if self.status == Status.COMPLETED and (
            not self.attempt_detected or self.metrics is None or self.score is None
        ):
            raise ValueError("Завершённый анализ требует попытку, метрики и оценку")
        return self
