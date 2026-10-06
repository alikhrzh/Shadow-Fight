import numpy as np
import pytest

from shadowcoach.analysis.normalization import normalize_frames
from shadowcoach.analysis.segmentation import segment
from shadowcoach.domain.enums import Hand, Move, Phase, Stance
from shadowcoach.pose.smoothing import smooth_frames
from tests.conftest import recording


@pytest.mark.parametrize("fps", [24, 30, 60])
def test_finds_start_peak_return(cfg, fps):
    frames, info = recording(fps=fps)
    data = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    result = segment(data, Hand.LEFT, Move.JAB, cfg)
    assert result.detected
    p = result.phases
    assert p.guard_start_frame < p.movement_start_frame < p.peak_frame < p.return_frame
    assert 750 < frames[p.movement_start_frame].timestamp_ms < 1050
    assert 1150 <= frames[p.peak_frame].timestamp_ms <= 1400
    assert result.states[p.peak_frame] == Phase.PEAK
    assert result.states[-1] == Phase.COMPLETE


def test_jitter_does_not_count_as_attempt(cfg):
    frames, info = recording(no_motion=True)
    rng = np.random.default_rng(10)
    for f in frames:
        f.landmarks["left_wrist"].x += rng.normal(0, 0.001)
        f.landmarks["right_wrist"].y += rng.normal(0, 0.001)
    data = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    result = segment(data, Hand.LEFT, Move.JAB, cfg)
    assert not result.detected
    assert result.reason == "no_attempt_detected"


def test_wrong_hand_is_detected(cfg):
    frames, info = recording(wrong_hand=True)
    result = segment(
        smooth_frames(normalize_frames(frames, info, cfg), cfg.pose), Hand.LEFT, Move.JAB, cfg
    )
    assert result.detected
    assert result.active_hand == Hand.RIGHT


def test_southpaw_is_anatomical_right(cfg):
    frames, info = recording(stance=Stance.SOUTHPAW)
    result = segment(
        smooth_frames(normalize_frames(frames, info, cfg), cfg.pose), Hand.RIGHT, Move.JAB, cfg
    )
    assert result.active_hand == Hand.RIGHT


def test_missing_return_stays_missing(cfg):
    frames, info = recording(no_return=True)
    result = segment(
        smooth_frames(normalize_frames(frames, info, cfg), cfg.pose), Hand.LEFT, Move.JAB, cfg
    )
    assert result.detected
    assert result.phases.return_frame is None
