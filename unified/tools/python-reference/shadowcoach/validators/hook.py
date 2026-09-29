from shadowcoach.config import MoveConfig
from shadowcoach.domain.models import AttemptFeatures, Phases, Violation
from shadowcoach.validators.base import BaseValidator, violation


class HookValidator(BaseValidator):
    def validate(self, f: AttemptFeatures, phases: Phases, cfg: MoveConfig) -> list[Violation]:
        result = super().validate(f, phases, cfg) + self.rotation(f, phases, cfg)
        elbow, wrist = f"{f.active_hand}_elbow", f"{f.active_hand}_wrist"
        if f.elbow_angle_peak is not None:
            if f.elbow_angle_peak > cfg.max_peak_elbow_angle:
                result.append(
                    violation(
                        "elbow_too_straight",
                        f.elbow_angle_peak / cfg.max_peak_elbow_angle - 1,
                        phases.peak_frame,
                        elbow,
                    )
                )
            elif f.elbow_angle_peak < cfg.min_peak_elbow_angle:
                result.append(
                    violation(
                        "elbow_too_bent",
                        1 - f.elbow_angle_peak / cfg.min_peak_elbow_angle,
                        phases.peak_frame,
                        elbow,
                    )
                )
        if (
            f.elbow_shoulder_vertical_gap is not None
            and cfg.max_elbow_shoulder_vertical_gap
            and (f.elbow_shoulder_vertical_gap > cfg.max_elbow_shoulder_vertical_gap)
        ):
            result.append(
                violation(
                    "elbow_too_low",
                    f.elbow_shoulder_vertical_gap / cfg.max_elbow_shoulder_vertical_gap - 1,
                    phases.peak_frame,
                    elbow,
                )
            )
        lateral_displacement = (
            f.medial_displacement
            if f.medial_displacement is not None
            else abs(f.horizontal_displacement)
        )
        if (
            cfg.min_horizontal_displacement
            and (lateral_displacement < cfg.min_horizontal_displacement)
            and not any(v.code == "low_amplitude" for v in result)
        ):
            result.append(
                violation(
                    "low_amplitude",
                    1 - lateral_displacement / cfg.min_horizontal_displacement,
                    phases.peak_frame,
                    wrist,
                )
            )
        if (
            f.trajectory_straightness is not None
            and cfg.max_trajectory_straightness
            and (f.trajectory_straightness > cfg.max_trajectory_straightness)
        ):
            result.append(
                violation(
                    "trajectory_too_straight",
                    (f.trajectory_straightness - cfg.max_trajectory_straightness)
                    / (1 - cfg.max_trajectory_straightness),
                    phases.peak_frame,
                    wrist,
                )
            )
        return result
