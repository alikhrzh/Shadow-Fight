from shadowcoach.analysis.geometry import unit_score
from shadowcoach.config import Config
from shadowcoach.domain.enums import Move
from shadowcoach.domain.models import AttemptFeatures


def score_attempt(
    f: AttemptFeatures, move: Move, cfg: Config
) -> tuple[
    int,
    dict[str, float],
    dict[str, float],
]:
    c, s = cfg.for_move(move), cfg.scoring
    components = {
        "completion": unit_score(f.wrist_displacement / c.min_wrist_displacement),
        "return": float(f.returned_to_guard),
    }
    if move == Move.HOOK and c.min_horizontal_displacement:
        lateral_displacement = (
            f.medial_displacement
            if f.medial_displacement is not None
            else abs(f.horizontal_displacement)
        )
        components["completion"] = unit_score(lateral_displacement / c.min_horizontal_displacement)
    if f.elbow_angle_peak is not None:
        components["extension"] = unit_score(
            (f.elbow_angle_peak - s.extension_zero_angle)
            / (s.extension_good_angle - s.extension_zero_angle)
        )
        center = (c.min_peak_elbow_angle + c.max_peak_elbow_angle) / 2
        half_width = (c.max_peak_elbow_angle - c.min_peak_elbow_angle) / 2
        components["elbow_form"] = unit_score(
            1 - max(0, abs(f.elbow_angle_peak - center) - half_width) / max(half_width, 1)
        )
    if f.other_hand_guard_distance_max is not None:
        components["guard"] = unit_score(
            (s.guard_zero_distance - f.other_hand_guard_distance_max)
            / (s.guard_zero_distance - s.guard_good_distance)
        )
    if f.trajectory_straightness is not None:
        components["trajectory"] = f.trajectory_straightness
        if move == Move.HOOK and c.max_trajectory_straightness:
            components["trajectory"] = unit_score(
                (1 - f.trajectory_straightness) / (1 - c.max_trajectory_straightness)
            )
    if f.shoulder_rotation is not None and c.min_shoulder_rotation:
        components["rotation"] = unit_score(f.shoulder_rotation / c.min_shoulder_rotation)
    if f.elbow_shoulder_vertical_gap is not None and c.max_elbow_shoulder_vertical_gap:
        components["elbow_height"] = unit_score(
            1
            - max(0, f.elbow_shoulder_vertical_gap - c.max_elbow_shoulder_vertical_gap)
            / c.max_elbow_shoulder_vertical_gap
        )
    # Missing metrics cannot silently become zero technique scores.
    weights = {
        name: weight for name, weight in c.weights.items() if name in components and weight > 0
    }
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("Нет доступных метрик для заданных весов оценки")
    weights = {name: weight / total for name, weight in weights.items()}
    used = {name: components[name] for name in weights}
    score = round(100 * sum(used[name] * weight for name, weight in weights.items()))
    if f.active_hand != f.expected_hand:
        score = min(score, s.wrong_hand_cap)
    return score, used, weights
