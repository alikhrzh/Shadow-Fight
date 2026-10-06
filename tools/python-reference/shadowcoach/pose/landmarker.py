from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from shadowcoach.config import PoseConfig
from shadowcoach.domain.enums import LANDMARK_NAMES
from shadowcoach.domain.models import FrameLandmarks, Landmark
from shadowcoach.errors import ShadowCoachError

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_full/float16/1/pose_landmarker_full.task"
)


def check_model(path: Path) -> None:
    if not path.is_file():
        raise ShadowCoachError(
            f"Модель MediaPipe не найдена: {path}\n"
            f"Скачайте Full-модель: {MODEL_URL}\nСохраните файл и укажите --model ПУТЬ."
        )
    if path.stat().st_size == 0:
        raise ShadowCoachError(f"Файл модели пуст: {path}")


class MediaPipeEstimator:
    def __init__(self, model_path: Path, cfg: PoseConfig):
        check_model(model_path)
        try:
            import mediapipe as mp
        except ImportError as exc:
            raise ShadowCoachError(
                "Установите зависимости: python -m pip install -e '.[dev]'"
            ) from exc
        self._mp = mp
        try:
            options = mp.tasks.vision.PoseLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(
                    model_asset_path=str(model_path), delegate=mp.tasks.BaseOptions.Delegate.CPU
                ),
                running_mode=mp.tasks.vision.RunningMode.VIDEO,
                num_poses=2,
                min_pose_detection_confidence=cfg.min_detection_confidence,
                min_pose_presence_confidence=cfg.min_presence,
                min_tracking_confidence=cfg.min_tracking_confidence,
                output_segmentation_masks=False,
            )
            self._landmarker = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        except (ValueError, RuntimeError, OSError) as exc:
            raise ShadowCoachError(f"Не удалось открыть модель MediaPipe: {exc}") from exc

    @staticmethod
    def _points(points: list[Any]) -> dict[str, Landmark]:
        return {
            name: Landmark(
                x=p.x,
                y=p.y,
                z=p.z,
                visibility=p.visibility if p.visibility is not None else 0,
                presence=p.presence if p.presence is not None else 0,
            )
            for name, p in zip(LANDMARK_NAMES, points, strict=True)
        }

    def detect(self, rgb: NDArray[np.uint8], frame: int, timestamp_ms: int) -> FrameLandmarks:
        image = self._mp.Image(
            image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)
        )
        result = self._landmarker.detect_for_video(image, timestamp_ms)
        poses, world = result.pose_landmarks, result.pose_world_landmarks
        return FrameLandmarks(
            frame=frame,
            timestamp_ms=timestamp_ms,
            pose_count=len(poses),
            landmarks=self._points(poses[0]) if poses else {},
            world_landmarks=self._points(world[0]) if world else {},
        )

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> "MediaPipeEstimator":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
