import math
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from shadowcoach.config import Config
from shadowcoach.domain.models import FrameLandmarks, VideoInfo
from shadowcoach.errors import ShadowCoachError


class Estimator(Protocol):
    def detect(self, rgb: NDArray[np.uint8], frame: int, timestamp_ms: int) -> FrameLandmarks: ...


def next_timestamp(decoder_ms: float, frame: int, fps: float, previous: int) -> int:
    nominal = round(frame * 1000 / fps)
    candidate = round(decoder_ms) if math.isfinite(decoder_ms) and decoder_ms >= 0 else nominal
    if frame == 0:
        return 0
    if candidate <= previous:
        candidate = max(nominal, previous + round(1000 / fps))
    return max(previous + 1, candidate)


def extract_video(
    video: Path,
    estimator: Estimator,
    cfg: Config,
    progress: Callable[[str], None] | None = None,
) -> tuple[list[FrameLandmarks], VideoInfo, list[str]]:
    cap = cv2.VideoCapture(str(video))
    try:
        if not cap.isOpened():
            raise ShadowCoachError(f"Не удалось открыть видео: {video}")
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if not math.isfinite(fps) or not 0 < fps <= 240:
            raise ShadowCoachError(
                "Видео имеет некорректный FPS. Пересохраните его с постоянным FPS."
            )
        expected_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frames: list[FrameLandmarks] = []
        previous = -1
        width = height = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            index = len(frames)
            if index == 0:
                height, width = bgr.shape[:2]
            elif bgr.shape[:2] != (height, width):
                raise ShadowCoachError("Размер кадра меняется внутри видео. Пересохраните файл.")
            timestamp = next_timestamp(float(cap.get(cv2.CAP_PROP_POS_MSEC)), index, fps, previous)
            if timestamp > cfg.pose.max_video_duration_ms or index / fps * 1000 > (
                cfg.pose.max_video_duration_ms
            ):
                raise ShadowCoachError(
                    "Видео слишком длинное. Обрежьте его до одной попытки (2–5 с)."
                )
            frames.append(estimator.detect(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), index, timestamp))
            previous = timestamp
            if progress and index % max(1, round(fps)) == 0:
                progress(
                    f"Извлечено кадров: {index + 1}"
                    + (f" / {expected_count}" if expected_count > 0 else "")
                )
        if not frames:
            raise ShadowCoachError("В видео нет декодируемых кадров.")
        warnings = []
        if expected_count > len(frames) + 1:
            raise ShadowCoachError(
                f"Видео прочитано не полностью: {len(frames)}/{expected_count} кадров."
            )
        intervals = np.diff([f.timestamp_ms for f in frames])
        if len(intervals) and float(np.std(intervals)) > 1000 / fps * 0.1:
            warnings.append(
                "Переменный FPS: метрики используют timestamps; "
                "итоговое видео имеет постоянный FPS."
            )
        return (
            frames,
            VideoInfo(
                width=width,
                height=height,
                fps=fps,
                frame_count=len(frames),
                duration_ms=frames[-1].timestamp_ms + 1000 / fps,
            ),
            warnings,
        )
    finally:
        cap.release()
