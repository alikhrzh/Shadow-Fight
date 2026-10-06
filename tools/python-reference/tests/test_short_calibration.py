import math

import pytest

from shadowcoach.analysis.normalization import normalize_frames
from shadowcoach.analysis.segmentation import calibrate_hand, segment
from shadowcoach.domain.enums import Hand, Move, Stance
from shadowcoach.pipeline import analyze_landmarks
from shadowcoach.pose.smoothing import smooth_frames
from tests.conftest import recording


def trim_start(frames, info, start_ms):
    selected = [f for f in frames if f.timestamp_ms >= start_ms]
    offset = selected[0].timestamp_ms
    trimmed = [
        f.model_copy(update={"frame": i, "timestamp_ms": f.timestamp_ms - offset})
        for i, f in enumerate(selected)
    ]
    return trimmed, info.model_copy(
        update={
            "frame_count": len(trimmed),
            "duration_ms": info.duration_ms - offset,
        }
    )


@pytest.mark.parametrize("fps", [24, 30, 60])
@pytest.mark.parametrize("stance", list(Stance))
def test_short_guard_and_already_lowered_free_hand(cfg, fps, stance):
    frames, info = recording(fps=fps, stance=stance)
    other = "right" if stance == Stance.ORTHODOX else "left"
    for f in frames:
        f.landmarks[f"{other}_wrist"].y = 0.70
        f.world_landmarks[f"{other}_wrist"].y = 0.45
    frames, info = trim_start(frames, info, 600)
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, stance, cfg)
    assert report.status == "completed"
    assert "guard_dropped" in [v.code for v in report.violations]
    assert "wrong_hand" not in [v.code for v in report.violations]
    p = report.phases
    assert p.guard_start_frame <= p.calibration_end_frame < p.movement_start_frame


def test_visible_moving_free_hand_does_not_block_striking_hand(cfg):
    frames, info = recording()
    for f in frames:
        f.landmarks["right_wrist"].y += 0.03 * math.sin(f.timestamp_ms / 24)
    report, normalized, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert calibrate_hand(normalized, Hand.RIGHT, cfg) is None
    assert report.status == "completed"
    assert report.metrics.active_hand == Hand.LEFT


def test_speed_spikes_in_compact_guard_are_not_motion(cfg):
    frames, info = recording(no_motion=True)
    for f in frames:
        f.landmarks["left_wrist"].x += 0.006 * (-1) ** f.frame
        f.landmarks["right_wrist"].y += 0.006 * (-1) ** f.frame
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.status == "no_attempt"


def test_do_not_calibrate_at_apex_when_video_starts_mid_punch(cfg):
    frames, info = recording()
    frames, info = trim_start(frames, info, 900)
    normalized = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    assert calibrate_hand(normalized, Hand.LEFT, cfg) is None
    result = segment(normalized, Hand.LEFT, Move.JAB, cfg)
    assert not result.detected
    assert result.reason == "guard_not_found"


def test_missing_expected_baseline_is_not_wrong_hand_proof(cfg):
    frames, info = recording()
    frames, info = trim_start(frames, info, 900)
    for f in frames:
        # Visible free arm begins moving after its own initial calibration.
        f.landmarks["right_wrist"].y += min(0.35, max(0, f.timestamp_ms - 250) / 1000)
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.status == "unreliable"
    assert report.quality.issues[0].code == "guard_not_found"
    assert not report.violations


def test_missing_point_breaks_calibration_window(cfg):
    frames, info = recording()
    for f in frames[:24]:
        if f.frame % 3 == 0:
            f.landmarks["left_wrist"].visibility = 0.1
    data = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    assert calibrate_hand(data, Hand.LEFT, cfg) is None


def test_long_timestamp_gap_is_not_a_stationary_hold(cfg):
    frames, info = recording()
    frames = frames[:3] + frames[24:]
    frames = [f.model_copy(update={"frame": i}) for i, f in enumerate(frames)]
    data = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    assert calibrate_hand(data, Hand.LEFT, cfg) is None


def test_truncated_return_is_not_fabricated(cfg):
    frames, info = recording()
    frames = [f for f in frames if f.timestamp_ms < 1550]
    report, _, _ = analyze_landmarks(frames, info, Move.JAB, Stance.ORTHODOX, cfg)
    assert report.status == "completed"
    assert not report.metrics.returned_to_guard
    assert "not_returned_to_guard" in [v.code for v in report.violations]
