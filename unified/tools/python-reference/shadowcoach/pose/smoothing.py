import numpy as np

from shadowcoach.analysis.normalization import Coordinates, NormalizedFrame
from shadowcoach.config import PoseConfig


def smooth_frames(frames: list[NormalizedFrame], cfg: PoseConfig) -> list[NormalizedFrame]:
    """Time-adjusted EMA. Missing points stay missing and reset their own history."""
    history: dict[str, Coordinates] = {"image": {}, "world": {}}
    previous_ms: int | None = None
    for frame in frames:
        timestamp = frame.raw.timestamp_ms
        dt = (timestamp - previous_ms) if previous_ms is not None else 1000 / cfg.reference_fps
        alpha = 1 - (1 - cfg.smoothing_alpha) ** (dt * cfg.reference_fps / 1000)
        for space in ("image", "world"):
            points: Coordinates = getattr(frame, space)
            previous = history[space] if dt <= cfg.max_gap_ms else {}
            smoothed = {
                name: np.array(
                    alpha * p + (1 - alpha) * previous[name] if name in previous else p, copy=True
                )
                for name, p in points.items()
            }
            setattr(frame, f"smooth_{space}", smoothed)
            history[space] = smoothed
        previous_ms = timestamp
    return frames
