import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from shadowcoach.domain.enums import Move, Stance
from shadowcoach.domain.results import Report
from shadowcoach.pipeline import run_analysis
from shadowcoach.pose.extractor import extract_video, next_timestamp
from tests.conftest import recording


def make_video(path: Path, count=40, fps=30):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (640, 480))
    assert writer.isOpened()
    try:
        for _ in range(count):
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            frame[:, :160] = (0, 0, 200)
            frame[:, 480:] = (200, 0, 0)
            writer.write(frame)
    finally:
        writer.release()


class SyntheticEstimator:
    """Explicit detector double: video I/O remains real; no MediaPipe model required."""

    def __init__(self, frames):
        self.frames = frames

    def detect(self, rgb, frame, timestamp_ms):
        assert rgb.shape == (480, 640, 3)
        return self.frames[frame].model_copy(update={"timestamp_ms": timestamp_ms})

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def test_monotonic_timestamps_with_broken_decoder():
    previous = -1
    values = []
    for i, decoder in enumerate([0, 0, 0, float("nan"), 20, 167]):
        previous = next_timestamp(decoder, i, 30, previous)
        values.append(previous)
    assert values == [0, 33, 67, 100, 133, 167]


def test_video_extractor_bgr_to_rgb(tmp_path, cfg):
    frames, _ = recording()
    video = tmp_path / "test.mp4"
    make_video(video, len(frames))

    class ColorCheckingEstimator(SyntheticEstimator):
        def detect(self, rgb, frame, timestamp_ms):
            assert rgb[0, 0, 0] > 180 and rgb[0, 0, 2] < 10
            return super().detect(rgb, frame, timestamp_ms)

    extracted, info, _ = extract_video(video, ColorCheckingEstimator(frames), cfg)
    assert len(extracted) == info.frame_count == len(frames)
    assert all(
        a.timestamp_ms < b.timestamp_ms for a, b in zip(extracted, extracted[1:], strict=False)
    )


def test_full_artifact_pipeline_and_mirror(tmp_path, monkeypatch, cfg):
    frames, _ = recording(dropped=True)
    video = tmp_path / "jab.mp4"
    make_video(video, len(frames))
    model = tmp_path / "model.task"
    model.write_bytes(b"synthetic estimator substituted in this test")
    monkeypatch.setattr(
        "shadowcoach.pose.landmarker.MediaPipeEstimator", lambda *_: SyntheticEstimator(frames)
    )
    cfg.render.codecs = ["mp4v"]
    output = tmp_path / "run"
    report = run_analysis(
        video, model, output, Move.JAB, Stance.ORTHODOX, cfg, mirror=True, save_frames=True
    )
    assert report.status == "completed" and report.violations[0].code == "guard_dropped"
    assert {p.name for p in output.iterdir()} == {
        "report.json",
        "landmarks.jsonl",
        "metrics.json",
        "summary.txt",
        "annotated.mp4",
        "debug",
    }
    assert Report.model_validate_json((output / "report.json").read_text()) == report
    rows = [json.loads(s) for s in (output / "landmarks.jsonl").read_text().splitlines()]
    assert len(rows) == len(frames)
    assert rows[0]["landmarks"]["left_wrist"]["x"] == frames[0].landmarks["left_wrist"].x
    assert "smoothed_image" in rows[0] and "world_landmarks" in rows[0]
    assert len(list((output / "debug").glob("*.jpg"))) > 10
    cap = cv2.VideoCapture(str(output / "annotated.mp4"))
    try:
        ok, first = cap.read()
        assert ok and first.shape[0] > 480
        # Before analysis the red block was on the left, after mirror blue is there.
        assert first[0, 0, 0] > 150 and first[0, 0, 2] < 20
        assert round(cap.get(cv2.CAP_PROP_FRAME_COUNT)) == len(frames)
    finally:
        cap.release()


@pytest.mark.integration
def test_real_mediapipe_blank_video(tmp_path, cfg):
    model = Path("models/pose_landmarker_full.task")
    if not model.is_file():
        pytest.skip("Local MediaPipe model not installed; see models/README.md")
    video = tmp_path / "empty-scene.mp4"
    make_video(video)
    # Keep a native dependency failure from aborting the entire pytest process.
    output = tmp_path / "real-run"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "shadowcoach",
            "analyze",
            "--video",
            str(video),
            "--model",
            str(model.resolve()),
            "--move",
            "jab",
            "--stance",
            "orthodox",
            "--output",
            str(output),
        ],
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert completed.returncode == 3, completed.stderr
    report = Report.model_validate_json((output / "report.json").read_text())
    assert report.status == "unreliable"
    assert report.score is None and not report.violations
    assert "person_not_detected" in [issue.code for issue in report.quality.issues]
    assert (tmp_path / "real-run" / "annotated.mp4").is_file()
