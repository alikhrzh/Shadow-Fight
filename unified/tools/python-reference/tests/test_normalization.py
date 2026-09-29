import numpy as np
import pytest

from shadowcoach.analysis.geometry import angle_degrees
from shadowcoach.analysis.normalization import normalize_frames
from tests.conftest import recording


def test_image_resolution_invariance(cfg):
    frames, info = recording()
    a = normalize_frames(frames, info, cfg)
    b = normalize_frames(frames, info.model_copy(update={"width": 1280, "height": 960}), cfg)
    np.testing.assert_allclose(a[35].image["left_wrist"], b[35].image["left_wrist"])


def test_body_size_translation_invariance(cfg):
    frames, info = recording()
    scaled = [f.model_copy(deep=True) for f in frames]
    for f in scaled:
        for point in f.landmarks.values():
            point.x = 0.5 + (point.x - 0.5) * 0.7
            point.y = 0.5 + (point.y - 0.5) * 0.7
            point.z *= 0.7
    a, b = normalize_frames(frames, info, cfg), normalize_frames(scaled, info, cfg)
    np.testing.assert_allclose(a[35].image["left_wrist"], b[35].image["left_wrist"])


def test_aspect_ratio_corrects_angles(cfg):
    frames, info = recording()
    for f in frames:
        for name, (x, y) in {
            "left_shoulder": (0.4, 0.4),
            "left_elbow": (0.5, 0.5),
            "left_wrist": (0.6, 0.4),
        }.items():
            f.landmarks[name].x, f.landmarks[name].y = x, y
    normalized = normalize_frames(frames, info, cfg)
    coords = normalized[0].image
    angle = angle_degrees(*(coords[f"left_{j}"][:2] for j in ("shoulder", "elbow", "wrist")))
    assert angle == pytest.approx(106.2602047)


def test_zero_shoulders_not_infinite(cfg):
    frames, info = recording()
    for f in frames:
        f.landmarks["right_shoulder"] = f.landmarks["left_shoulder"].model_copy()
    assert all(not f.image for f in normalize_frames(frames, info, cfg))
