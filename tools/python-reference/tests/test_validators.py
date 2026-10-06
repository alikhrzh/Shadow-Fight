import pytest

from shadowcoach.domain.enums import Hand, Move, Stance
from shadowcoach.domain.models import AttemptFeatures, Phases
from shadowcoach.pipeline import analyze_landmarks
from shadowcoach.validators import VALIDATORS
from tests.conftest import recording


def good_features(hand=Hand.LEFT):
    return AttemptFeatures(
        active_hand=hand,
        expected_hand=hand,
        duration_ms=800,
        max_wrist_speed=3,
        wrist_displacement=1,
        horizontal_displacement=0.7,
        vertical_displacement=0.1,
        elbow_angle_peak=170,
        other_hand_guard_distance_max=0.4,
        shoulder_rotation=0.2,
        elbow_shoulder_vertical_gap=0.1,
        trajectory_straightness=0.97,
        return_distance=0.1,
        returned_to_guard=True,
        pose_quality="good",
        angle_coordinate_space="world_3d",
        guard_worst_frame=30,
    )


@pytest.mark.parametrize(
    ("move", "updates", "code"),
    [
        (Move.JAB, {"active_hand": Hand.RIGHT}, "wrong_hand"),
        (Move.JAB, {"other_hand_guard_distance_max": 1.2}, "guard_dropped"),
        (Move.JAB, {"elbow_angle_peak": 120}, "insufficient_extension"),
        (Move.JAB, {"trajectory_straightness": 0.65}, "trajectory_not_straight"),
        (Move.JAB, {"wrist_displacement": 0.2}, "low_amplitude"),
        (Move.CROSS, {"shoulder_rotation": 0.01}, "no_shoulder_rotation"),
        (Move.HOOK, {"elbow_angle_peak": 160}, "elbow_too_straight"),
        (Move.HOOK, {"elbow_angle_peak": 45}, "elbow_too_bent"),
        (Move.HOOK, {"elbow_shoulder_vertical_gap": 0.7}, "elbow_too_low"),
        (Move.HOOK, {"trajectory_straightness": 0.99}, "trajectory_too_straight"),
        (Move.HOOK, {"medial_displacement": 0.1, "horizontal_displacement": 0.8}, "low_amplitude"),
        (Move.JAB, {"returned_to_guard": False}, "not_returned_to_guard"),
    ],
)
def test_rules(cfg, move, updates, code):
    f = good_features().model_copy(update=updates)
    phases = Phases(guard_start_frame=0, movement_start_frame=15, peak_frame=30, end_frame=60)
    violations = VALIDATORS[move]().validate(f, phases, cfg.for_move(move))
    match = next(v for v in violations if v.code == code)
    assert 0 <= match.severity <= 1
    assert match.message and match.related_joints


@pytest.mark.parametrize("move", list(Move))
@pytest.mark.parametrize("stance", list(Stance))
def test_complete_pipeline_each_move_and_stance(cfg, move, stance):
    frames, info = recording(move=move, stance=stance)
    report, _, _ = analyze_landmarks(frames, info, move, stance, cfg)
    assert report.status == "completed"
    assert report.attempt_detected
    assert report.score is not None
    assert report.metrics.returned_to_guard
    assert report.metrics.active_hand == report.metrics.expected_hand
    assert not report.violations
    assert report.score >= 85


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({"wrong_hand": True}, "wrong_hand"),
        ({"dropped": True}, "guard_dropped"),
        ({"no_return": True}, "not_returned_to_guard"),
        ({"extension": 0.6}, "insufficient_extension"),
    ],
)
def test_pipeline_finds_concrete_fault(cfg, kwargs, code):
    frames, info = recording(**kwargs)
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.status == "completed"
    assert code in [v.code for v in report.violations]
    if code == "wrong_hand":
        assert report.score <= cfg.scoring.wrong_hand_cap
