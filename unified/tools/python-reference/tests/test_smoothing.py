import numpy as np

from shadowcoach.analysis.normalization import normalize_frames
from shadowcoach.pose.smoothing import smooth_frames
from tests.conftest import recording


def test_smoothing_reduces_noise_without_changing_raw(cfg):
    frames, info = recording(no_motion=True)
    rng = np.random.default_rng(42)
    for f in frames:
        f.landmarks["left_wrist"].x += rng.normal(0, 0.007)
    before = [f.model_dump_json() for f in frames]
    result = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    raw = [f.image["left_wrist"][0] for f in result]
    smooth = [f.smooth_image["left_wrist"][0] for f in result]
    assert np.std(smooth) < np.std(raw) * 0.8
    assert before == [f.model_dump_json() for f in frames]


def test_missing_point_not_fabricated(cfg):
    frames, info = recording()
    frames[30].landmarks["left_wrist"].visibility = 0
    result = smooth_frames(normalize_frames(frames, info, cfg), cfg.pose)
    assert "left_wrist" not in result[30].smooth_image
    np.testing.assert_allclose(
        result[31].image["left_wrist"], result[31].smooth_image["left_wrist"]
    )
