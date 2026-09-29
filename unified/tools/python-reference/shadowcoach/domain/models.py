from pydantic import BaseModel, ConfigDict, Field, model_validator

from shadowcoach.domain.enums import Hand


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Landmark(Schema):
    x: float
    y: float
    z: float
    visibility: float = Field(default=0, ge=0, le=1)
    presence: float = Field(default=0, ge=0, le=1)


class FrameLandmarks(Schema):
    frame: int = Field(ge=0)
    timestamp_ms: int = Field(ge=0)
    pose_count: int = Field(default=0, ge=0)
    landmarks: dict[str, Landmark] = Field(default_factory=dict)
    world_landmarks: dict[str, Landmark] = Field(default_factory=dict)


class VideoInfo(Schema):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: float = Field(gt=0, le=240)
    frame_count: int = Field(ge=0)
    duration_ms: float = Field(ge=0)
    timestamp_source: str = "decoder_with_fps_fallback"


class Phases(Schema):
    guard_start_frame: int | None = Field(default=None, ge=0)
    calibration_end_frame: int | None = Field(default=None, ge=0)
    movement_start_frame: int | None = Field(default=None, ge=0)
    peak_frame: int | None = Field(default=None, ge=0)
    return_frame: int | None = Field(default=None, ge=0)
    end_frame: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def chronological(self) -> "Phases":
        sequence = [
            self.guard_start_frame,
            self.calibration_end_frame,
            self.movement_start_frame,
            self.peak_frame,
            self.return_frame,
            self.end_frame,
        ]
        present = [i for i in sequence if i is not None]
        if present != sorted(present):
            raise ValueError("Фазы должны идти в хронологическом порядке")
        return self


class QualityIssue(Schema):
    code: str
    message: str
    frame: int | None = None
    related_joints: list[str] = Field(default_factory=list)


class PoseQuality(Schema):
    level: str = "good"
    keypoint_coverage: dict[str, float] = Field(default_factory=dict)
    issues: list[QualityIssue] = Field(default_factory=list)

    @property
    def reliable(self) -> bool:
        return not self.issues


class AttemptFeatures(Schema):
    active_hand: Hand
    expected_hand: Hand
    duration_ms: float = Field(ge=0)
    max_wrist_speed: float = Field(ge=0)
    wrist_displacement: float = Field(ge=0)
    horizontal_displacement: float
    medial_displacement: float | None = None
    vertical_displacement: float
    depth_displacement: float | None = None
    elbow_angle_start: float | None = None
    elbow_angle_peak: float | None = None
    elbow_angle_range: float | None = None
    max_elbow_angle: float | None = None
    other_hand_guard_distance_max: float | None = None
    other_hand_guard_distance_mean: float | None = None
    guard_distance_peak: float | None = None
    guard_worst_frame: int | None = None
    shoulder_rotation: float | None = None
    elbow_shoulder_vertical_gap: float | None = None
    trajectory_straightness: float | None = None
    return_distance: float | None = None
    return_worst_frame: int | None = None
    returned_to_guard: bool
    pose_quality: str
    angle_coordinate_space: str
    motion_coordinate_space: str = "aspect_corrected_image_2d"
    rotation_coordinate_space: str | None = None


class Violation(Schema):
    code: str
    severity: float = Field(ge=0, le=1)
    message: str
    frame: int | None = Field(default=None, ge=0)
    related_joints: list[str] = Field(default_factory=list)
