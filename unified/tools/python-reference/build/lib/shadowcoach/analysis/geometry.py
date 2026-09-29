from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

Point = Sequence[float] | NDArray[np.float64]
EPSILON = 1e-9


def distance(a: Point, b: Point) -> float:
    return float(np.linalg.norm(np.asarray(a, dtype=float) - np.asarray(b, dtype=float)))


def angle_degrees(shoulder: Point, elbow: Point, wrist: Point) -> float | None:
    a = np.asarray(shoulder, dtype=float) - np.asarray(elbow, dtype=float)
    b = np.asarray(wrist, dtype=float) - np.asarray(elbow, dtype=float)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if not np.isfinite(denom) or denom < EPSILON:
        return None
    return float(np.degrees(np.arccos(np.clip(np.dot(a, b) / denom, -1, 1))))


def straightness(points: Sequence[Point]) -> float | None:
    """Endpoint distance / travelled path length; outbound phase only."""
    if len(points) < 2:
        return None
    path = sum(distance(a, b) for a, b in zip(points, points[1:], strict=False))
    return min(1.0, distance(points[0], points[-1]) / path) if path > EPSILON else None


def unit_score(value: float) -> float:
    return float(np.clip(value, 0, 1))
