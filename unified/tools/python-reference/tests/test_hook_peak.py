import math

import numpy as np
import pytest

from shadowcoach.analysis.hook_peak import select_hook_peak
from shadowcoach.analysis.normalization import NormalizedFrame
from shadowcoach.analysis.segmentation import segment
from shadowcoach.domain.enums import Hand, Move, Stance
from shadowcoach.domain.models import FrameLandmarks
from shadowcoach.pipeline import analyze_landmarks
from tests.conftest import recording


def arc(fps=30, hand=Hand.LEFT, roll=0, reflected=False, outlier=False, medial=True):
    # Wind-up radius > 1; actual strike radius < 1. Frame coordinates are in
    # shoulder-width units, so this isolates phase selection from MediaPipe.
    times = [0, 0.8, 0.95, 1.1, 1.3, 1.45, 1.7, 2.2]
    xy = np.array(
        [[0, 0], [0, 0], [-1.1, 0.7], [-0.7, -0.6], [0.65, -0.3], [0.65, -0.3], [0, 0], [0, 0]]
    )
    if not medial:
        xy[:, 0] = 0
    sign = 1 if hand == Hand.LEFT else -1
    rotation = np.array([[math.cos(roll), -math.sin(roll)], [math.sin(roll), math.cos(roll)]])
    reflection = np.diag([-1 if reflected else 1, 1])
    transform = rotation @ reflection
    baseline = np.array([-0.1 * sign, -0.3])
    frames = []
    for i in range(round(2.2 * fps)):
        t = i / fps
        point = baseline + np.array(
            [np.interp(t, times, xy[:, 0]) * sign, np.interp(t, times, xy[:, 1])]
        )
        if outlier and i == round(fps * 1.0):
            point[0] = 4 * sign
        raw = FrameLandmarks(frame=i, timestamp_ms=round(t * 1000), pose_count=1)
        points = {
            "left_shoulder": np.array([-0.5, 0.0]),
            "right_shoulder": np.array([0.5, 0.0]),
            f"{hand}_wrist": point,
            f"{hand.other}_wrist": np.array([0.1 * sign, -0.3]),
        }
        image = {name: np.r_[transform @ value, 0.0] for name, value in points.items()}
        frames.append(NormalizedFrame(raw=raw, image=image, smooth_image=image))
    return frames, transform @ baseline


@pytest.mark.parametrize("fps", [24, 30, 60])
@pytest.mark.parametrize("hand", list(Hand))
@pytest.mark.parametrize("roll", [0, math.radians(25)])
@pytest.mark.parametrize("reflected", [False, True])
def test_larger_windup_does_not_win_peak(cfg, fps, hand, roll, reflected):
    frames, baseline = arc(fps, hand, roll, reflected)
    peak = select_hook_peak(
        frames, hand, round(0.8 * fps), len(frames), 0, round(0.3 * fps), baseline, cfg
    )
    assert peak is not None
    assert 1250 <= frames[peak].raw.timestamp_ms <= 1450
    result = segment(frames, hand, Move.HOOK, cfg)
    assert result.detected and result.peak_method == "hook_medial_sweep"
    assert 1250 <= frames[result.phases.peak_frame].raw.timestamp_ms <= 1450
    assert result.phases.return_frame > result.phases.peak_frame


def test_one_frame_outlier_cannot_select_windup(cfg):
    frames, baseline = arc(outlier=True)
    peak = select_hook_peak(frames, Hand.LEFT, 24, len(frames), 0, 9, baseline, cfg)
    assert peak is not None and frames[peak].raw.timestamp_ms >= 1250


def test_unsupported_view_is_explicitly_ambiguous(cfg):
    frames, baseline = arc(medial=False)
    assert select_hook_peak(frames, Hand.LEFT, 24, len(frames), 0, 9, baseline, cfg) is None
    result = segment(frames, Hand.LEFT, Move.HOOK, cfg)
    assert not result.detected and result.reason == "hook_peak_ambiguous"


def test_missing_wrist_is_never_selected_as_peak(cfg):
    frames, baseline = arc()
    for frame in frames:
        if 1200 <= frame.raw.timestamp_ms <= 1500:
            frame.image.pop("left_wrist", None)
    peak = select_hook_peak(frames, Hand.LEFT, 24, len(frames), 0, 9, baseline, cfg)
    assert peak is None or "left_wrist" in frames[peak].image


def test_no_calibrated_shoulder_axis_means_no_peak(cfg):
    frames, baseline = arc()
    for frame in frames[:10]:
        frame.image.pop("right_shoulder")
    assert select_hook_peak(frames, Hand.LEFT, 24, len(frames), 0, 9, baseline, cfg) is None


def test_ambiguous_hook_is_unreliable_not_bad_technique(cfg):
    frames, info = recording(move=Move.HOOK)
    for f in frames:
        q = max(0, min(1, (f.timestamp_ms - 800) / 350))
        if f.timestamp_ms > 1250:
            q = max(0, 1 - (f.timestamp_ms - 1250) / 350)
        f.landmarks["left_wrist"].x = 0.46
        f.landmarks["left_wrist"].y = 0.26 + 0.30 * q
    report, _, _ = analyze_landmarks(frames, info, Move.HOOK, Stance.ORTHODOX, cfg)
    assert report.status == "unreliable"
    assert report.quality.issues[0].code == "hook_peak_ambiguous"
    assert report.peak_method == "hook_medial_sweep"
    assert report.score is None and not report.violations


def test_body_turn_does_not_rotate_calibrated_axis(cfg):
    frames, baseline = arc()
    expected = select_hook_peak(frames, Hand.LEFT, 24, len(frames), 0, 9, baseline, cfg)
    for f in frames[24:]:
        f.image["left_shoulder"] = np.array([0.0, -0.5, 0.0])
        f.image["right_shoulder"] = np.array([0.0, 0.5, 0.0])
    assert select_hook_peak(frames, Hand.LEFT, 24, len(frames), 0, 9, baseline, cfg) == expected
