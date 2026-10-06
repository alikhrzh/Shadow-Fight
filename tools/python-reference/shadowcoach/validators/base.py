from shadowcoach.analysis.geometry import unit_score
from shadowcoach.config import MoveConfig
from shadowcoach.domain.models import AttemptFeatures, Phases, Violation
from shadowcoach.feedback.catalog import MESSAGES


def violation(code: str, severity: float, frame: int | None, *joints: str) -> Violation:
    return Violation(
        code=code,
        severity=unit_score(severity),
        message=MESSAGES[code],
        frame=frame,
        related_joints=list(joints),
    )


class BaseValidator:
    def validate(self, f: AttemptFeatures, phases: Phases, cfg: MoveConfig) -> list[Violation]:
        result = []
        wrist, other = f"{f.active_hand}_wrist", f"{f.active_hand.other}_wrist"
        if f.active_hand != f.expected_hand:
            result.append(violation("wrong_hand", 1, phases.peak_frame, wrist))
        if f.wrist_displacement < cfg.min_wrist_displacement:
            result.append(
                violation(
                    "low_amplitude",
                    1 - f.wrist_displacement / cfg.min_wrist_displacement,
                    phases.peak_frame,
                    wrist,
                )
            )
        if f.other_hand_guard_distance_max is not None and (
            f.other_hand_guard_distance_max > cfg.max_guard_distance
        ):
            result.append(
                violation(
                    "guard_dropped",
                    f.other_hand_guard_distance_max / cfg.max_guard_distance - 1,
                    f.guard_worst_frame,
                    other,
                )
            )
        if not f.returned_to_guard:
            result.append(violation("not_returned_to_guard", 1, phases.end_frame, wrist))
        if not cfg.min_attempt_duration_ms <= f.duration_ms <= cfg.max_attempt_duration_ms:
            excess = (cfg.min_attempt_duration_ms - f.duration_ms) / cfg.min_attempt_duration_ms
            if f.duration_ms > cfg.max_attempt_duration_ms:
                excess = f.duration_ms / cfg.max_attempt_duration_ms - 1
            result.append(violation("timing_out_of_range", excess, phases.end_frame, wrist))
        return result

    def extension(self, f: AttemptFeatures, p: Phases, c: MoveConfig) -> list[Violation]:
        if f.elbow_angle_peak is not None and f.elbow_angle_peak < c.min_peak_elbow_angle:
            return [
                violation(
                    "insufficient_extension",
                    1 - f.elbow_angle_peak / c.min_peak_elbow_angle,
                    p.peak_frame,
                    f"{f.active_hand}_elbow",
                )
            ]
        return []

    def rotation(self, f: AttemptFeatures, p: Phases, c: MoveConfig) -> list[Violation]:
        if (
            c.min_shoulder_rotation is not None
            and f.shoulder_rotation is not None
            and (f.shoulder_rotation < c.min_shoulder_rotation)
        ):
            return [
                violation(
                    "no_shoulder_rotation",
                    1 - f.shoulder_rotation / c.min_shoulder_rotation,
                    p.peak_frame,
                    "left_shoulder",
                    "right_shoulder",
                )
            ]
        return []
