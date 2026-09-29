import pytest
from pydantic import ValidationError

from shadowcoach.domain.enums import Move, Stance
from shadowcoach.domain.results import Report
from shadowcoach.pipeline import analyze_landmarks
from tests.conftest import recording


@pytest.mark.parametrize(
    ("fault", "code"),
    [
        ("none", "person_not_detected"),
        ("wrist", "wrist_not_visible"),
        ("multiple", "multiple_people"),
        ("crop", "body_out_of_frame"),
        ("short", "video_too_short"),
    ],
)
def test_bad_data_never_becomes_bad_technique(cfg, fault, code):
    frames, info = recording()
    if fault == "short":
        frames = frames[:10]
    for f in frames:
        if fault == "none":
            f.pose_count, f.landmarks, f.world_landmarks = 0, {}, {}
        elif fault == "wrist":
            f.landmarks["left_wrist"].visibility = 0.1
        elif fault == "multiple":
            f.pose_count = 2
        elif fault == "crop":
            f.landmarks["left_elbow"].x = 1.2
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.status == "unreliable"
    assert report.score is None and report.violations == []
    assert code in [i.code for i in report.quality.issues]


def test_bad_peak_hidden_by_global_coverage_is_rejected(cfg):
    frames, info = recording()
    for f in frames[35:41]:
        f.landmarks["right_wrist"].visibility = 0.1
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.quality.keypoint_coverage["right_wrist"] > 0.7
    assert report.status == "unreliable"
    assert report.score is None and not report.violations


def test_no_attempt_diagnostic(cfg):
    frames, info = recording(no_motion=True)
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.status == "no_attempt" and report.score is None
    assert report.quality.issues[0].code == "no_attempt_detected"


def test_long_occlusion_during_return_is_not_technique_error(cfg):
    frames, info = recording()
    for f in frames[42:48]:
        f.landmarks["right_wrist"].visibility = 0.1
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.status == "unreliable"
    assert report.score is None and report.violations == []


def test_no_world_rotation_does_not_become_failure(cfg):
    frames, info = recording(move=Move.CROSS, world=False)
    report, _, _ = analyze_landmarks(frames, info, Move.CROSS, Stance.ORTHODOX, cfg)
    assert report.status == "completed"
    assert report.metrics.shoulder_rotation is None
    assert "rotation" not in report.effective_weights
    assert sum(report.effective_weights.values()) == pytest.approx(1)
    assert "no_shoulder_rotation" not in [v.code for v in report.violations]


def test_report_round_trip_and_score_constraint(cfg):
    frames, info = recording()
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert Report.model_validate_json(report.model_dump_json()) == report
    invalid = report.model_dump()
    invalid["status"] = "unreliable"
    with pytest.raises(ValidationError):
        Report.model_validate(invalid)
