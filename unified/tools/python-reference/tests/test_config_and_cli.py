import subprocess
import sys
from pathlib import Path

import pytest

from shadowcoach.config import load_config
from shadowcoach.errors import ShadowCoachError


def cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "shadowcoach", *args], capture_output=True, text=True, timeout=30
    )


def test_help_and_required_arguments():
    assert cli("--help").returncode == 0
    assert "--save-frames" in cli("analyze", "--help").stdout
    assert cli("analyze").returncode == 2


def test_missing_video_is_actionable(tmp_path):
    result = cli(
        "analyze",
        "--video",
        str(tmp_path / "absent.mp4"),
        "--move",
        "jab",
        "--stance",
        "orthodox",
        "--output",
        str(tmp_path / "run"),
    )
    assert result.returncode == 1
    assert "Видео не найдено" in result.stderr
    assert "Traceback" not in result.stderr


def test_missing_model_is_actionable(tmp_path):
    video = tmp_path / "input.mp4"
    video.write_bytes(b"input validation stops before decoding")
    result = cli(
        "analyze",
        "--video",
        str(video),
        "--move",
        "jab",
        "--stance",
        "orthodox",
        "--model",
        str(tmp_path / "missing.task"),
        "--output",
        str(tmp_path / "run"),
    )
    assert result.returncode == 1
    assert "Модель MediaPipe не найдена" in result.stderr
    assert "https://storage.googleapis.com/" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    "yaml",
    [
        "pose: {smoothing_alpha: 2}",
        "pose: {min_visibility: .nan}",
        "pose: {unknown_option: 1}",
        "jab: {weights: {misspelled: 1}}",
        "hook: {min_peak_elbow_angle: 150, max_peak_elbow_angle: 90}",
        "segmentation: {still_speed_threshold: 5}",
        "segmentation: {min_calibration_ms: 400}",
        "segmentation: {max_calibration_spread: 0.2}",
        "segmentation: {hook_peak_plateau_tolerance: 0.2}",
        "segmentation: {hook_peak_smoothing_ms: 0}",
        "[1, 2, 3]",
        "render: {codecs: [h264long]}",
        "pose: {min_video_frames: true}",
        "hook: {max_trajectory_straightness: 1}",
        "jab: {min_peak_elbow_angle: 0}",
    ],
)
def test_bad_config_rejected(tmp_path, yaml):
    path = tmp_path / "bad.yaml"
    path.write_text(yaml, encoding="utf-8")
    with pytest.raises(ShadowCoachError, match="конфигурации"):
        load_config(path)


def test_override_keeps_other_defaults(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("jab: {min_wrist_displacement: 0.6}", encoding="utf-8")
    cfg = load_config(path)
    assert cfg.jab.min_wrist_displacement == 0.6
    assert cfg.jab.max_guard_distance == 0.7
    assert cfg.hook.min_peak_elbow_angle == 65


def test_existing_output_preserved(tmp_path):
    from shadowcoach.domain.enums import Move, Stance
    from shadowcoach.pipeline import run_analysis

    video, model = tmp_path / "video.mp4", tmp_path / "model.task"
    video.write_bytes(b"video")
    model.write_bytes(b"model")
    output = tmp_path / "existing"
    output.mkdir()
    saved = output / "report.json"
    saved.write_text("keep me", encoding="utf-8")
    with pytest.raises(ShadowCoachError, match="не пуста"):
        run_analysis(video, model, output, Move.JAB, Stance.ORTHODOX, load_config())
    assert saved.read_text() == "keep me"


def test_packaged_defaults_available_outside_project(tmp_path):
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from shadowcoach.config import load_config; "
            "print(load_config().jab.max_guard_distance)",
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0 and result.stdout.strip() == "0.7"


def test_public_config_loads():
    assert load_config(Path("configs/thresholds.yaml")).cross.min_shoulder_rotation == 0.08
