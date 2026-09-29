from importlib.resources import files
from pathlib import Path
from typing import Annotated, Any

import yaml
from pydantic import Field, ValidationError, model_validator

from shadowcoach.domain.enums import Move
from shadowcoach.domain.models import Schema
from shadowcoach.errors import ShadowCoachError

Fraction = Annotated[float, Field(gt=0, le=1)]
Positive = Annotated[float, Field(gt=0)]
Count = Annotated[int, Field(gt=0, strict=True)]


class PoseConfig(Schema):
    min_visibility: Fraction
    min_presence: Fraction
    min_keypoint_coverage: Fraction
    min_peak_coverage: Fraction
    peak_window_ms: Positive
    multiple_people_frames: Count
    min_shoulder_width: Positive
    max_shoulder_scale_ratio: Annotated[float, Field(gt=1)]
    min_video_duration_ms: Positive
    max_video_duration_ms: Positive
    min_video_frames: Count
    max_gap_ms: Positive
    min_detection_confidence: Fraction
    min_tracking_confidence: Fraction
    smoothing_alpha: Fraction
    reference_fps: Positive
    min_world_coverage: Fraction


class SegmentationConfig(Schema):
    baseline_window_ms: Positive
    calibration_ms: Positive
    min_calibration_ms: Positive = 150
    max_calibration_spread: Positive = 0.10
    hook_peak_smoothing_ms: Positive = 100
    hook_min_medial_progress: Positive = 0.12
    hook_peak_plateau_tolerance: Positive = 0.04
    still_speed_threshold: Positive
    movement_speed_threshold: Positive
    min_start_displacement: Positive
    min_attempt_displacement: Positive
    confirmation_frames: Count
    confirmation_ms: Positive
    min_attempt_frames: Count
    max_attempt_duration_ms: Positive
    return_hold_ms: Positive
    active_hand_ratio: Annotated[float, Field(gt=1)]

    @model_validator(mode="after")
    def ranges(self) -> "SegmentationConfig":
        if self.still_speed_threshold >= self.movement_speed_threshold:
            raise ValueError("still_speed_threshold должен быть меньше movement_speed_threshold")
        if self.calibration_ms > self.baseline_window_ms:
            raise ValueError("calibration_ms должен помещаться в baseline_window_ms")
        if self.min_calibration_ms > self.calibration_ms:
            raise ValueError("min_calibration_ms должен быть <= calibration_ms")
        if self.max_calibration_spread >= self.min_start_displacement:
            raise ValueError("max_calibration_spread должен быть < min_start_displacement")
        if self.hook_peak_plateau_tolerance >= self.hook_min_medial_progress:
            raise ValueError("hook_peak_plateau_tolerance должен быть < hook_min_medial_progress")
        if self.min_start_displacement > self.min_attempt_displacement:
            raise ValueError("min_start_displacement должен быть <= min_attempt_displacement")
        return self


class MoveConfig(Schema):
    min_wrist_displacement: Positive
    min_peak_elbow_angle: Annotated[float, Field(gt=0, le=180)]
    max_peak_elbow_angle: Annotated[float, Field(gt=0, le=180)]
    max_guard_distance: Positive
    max_return_distance: Positive
    min_attempt_duration_ms: Positive
    max_attempt_duration_ms: Positive
    min_horizontal_displacement: Positive | None = None
    min_trajectory_straightness: Fraction | None = None
    max_trajectory_straightness: Annotated[float, Field(gt=0, lt=1)] | None = None
    max_elbow_shoulder_vertical_gap: Positive | None = None
    min_shoulder_rotation: Positive | None = None
    weights: dict[str, Annotated[float, Field(ge=0, le=1)]]

    @model_validator(mode="after")
    def ranges(self) -> "MoveConfig":
        if self.min_peak_elbow_angle >= self.max_peak_elbow_angle:
            raise ValueError("Перепутаны минимальный и максимальный угол")
        if self.min_attempt_duration_ms >= self.max_attempt_duration_ms:
            raise ValueError("Перепутаны минимальная и максимальная длительность")
        known = {
            "completion",
            "extension",
            "trajectory",
            "guard",
            "return",
            "rotation",
            "elbow_form",
            "elbow_height",
        }
        if not self.weights or sum(self.weights.values()) <= 0 or set(self.weights) - known:
            raise ValueError("Неверные имена или сумма весов scoring")
        return self


class FeedbackConfig(Schema):
    max_violations_in_report: Count
    priority: list[str]


class ScoringConfig(Schema):
    extension_zero_angle: float
    extension_good_angle: float
    guard_good_distance: float
    guard_zero_distance: float
    wrong_hand_cap: Annotated[int, Field(ge=0, le=100)]

    @model_validator(mode="after")
    def ranges(self) -> "ScoringConfig":
        if not 0 <= self.extension_zero_angle < self.extension_good_angle <= 180:
            raise ValueError("Неверный диапазон оценки разгибания")
        if not 0 <= self.guard_good_distance < self.guard_zero_distance:
            raise ValueError("Неверный диапазон оценки защиты")
        return self


class RenderConfig(Schema):
    codecs: list[str] = Field(min_length=1)
    font_path: str | None
    highlight_window_ms: Positive
    debug_stride: Count
    panel_height: Annotated[int, Field(ge=120, le=600)]

    @model_validator(mode="after")
    def fourcc(self) -> "RenderConfig":
        if any(len(c) != 4 for c in self.codecs):
            raise ValueError("Имя кодека должно содержать четыре символа")
        return self


class ModelConfig(Schema):
    path: str


class Config(Schema):
    pose: PoseConfig
    segmentation: SegmentationConfig
    feedback: FeedbackConfig
    scoring: ScoringConfig
    jab: MoveConfig
    cross: MoveConfig
    hook: MoveConfig
    render: RenderConfig
    model: ModelConfig

    def for_move(self, move: Move) -> MoveConfig:
        return getattr(self, move.value)

    @model_validator(mode="after")
    def required_move_thresholds(self) -> "Config":
        required = {
            "jab": ("min_trajectory_straightness",),
            "cross": ("min_shoulder_rotation",),
            "hook": (
                "min_horizontal_displacement",
                "max_trajectory_straightness",
                "max_elbow_shoulder_vertical_gap",
                "min_shoulder_rotation",
            ),
        }
        for move, keys in required.items():
            if any(getattr(getattr(self, move), key) is None for key in keys):
                raise ValueError(f"Отсутствуют обязательные пороги {move}")
        if self.pose.max_video_duration_ms <= self.pose.min_video_duration_ms:
            raise ValueError("Неверный диапазон длительности видео")
        return self


def _merge(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config(path: Path | None = None) -> Config:
    try:
        data = yaml.safe_load(files("shadowcoach").joinpath("defaults.yaml").read_text("utf-8"))
        if path is not None:
            override = yaml.safe_load(path.read_text("utf-8"))
            if not isinstance(override, dict):
                raise ValueError("Корень YAML должен быть объектом с настройками")
            data = _merge(data, override)
        return Config.model_validate(data)
    except (OSError, ValueError, yaml.YAMLError, ValidationError) as exc:
        raise ShadowCoachError(f"Ошибка конфигурации: {exc}") from exc
