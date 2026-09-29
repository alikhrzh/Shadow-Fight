"""Select the terminal medial sweep of a hook, not the outward wind-up."""

import numpy as np
from numpy.typing import NDArray

from shadowcoach.analysis.normalization import NormalizedFrame
from shadowcoach.config import Config
from shadowcoach.domain.enums import Hand


def medial_axis(
    frames: list[NormalizedFrame], hand: Hand, guard_start: int, baseline_end: int, cfg: Config
) -> NDArray[np.float64] | None:
    names = (f"{hand}_shoulder", f"{hand.other}_shoulder")
    axes = [
        f.image[names[1]][:2] - f.image[names[0]][:2]
        for f in frames[guard_start : baseline_end + 1]
        if all(name in f.image for name in names)
    ]
    if not axes:
        return None
    axis = np.median(axes, axis=0)
    norm = float(np.linalg.norm(axis))
    return axis / norm if norm >= cfg.pose.min_shoulder_width else None


def select_hook_peak(
    frames: list[NormalizedFrame],
    hand: Hand,
    start: int,
    end: int,
    guard_start: int,
    baseline_end: int,
    baseline: NDArray[np.float64],
    cfg: Config,
) -> int | None:
    """Return the center of a supported peak sweep toward the opposite shoulder.

    Freeze the anatomical lateral axis during calibration. This works for either
    hand and camera roll without assuming that anatomical left means screen left.
    A time-based centered median avoids EMA phase lag and isolated wrist spikes.
    No technique angle/score or dataset annotation is used to choose the peak.
    None means the view/motion does not support this peak estimate: do not fall
    back to a radial maximum that could silently pick the wind-up again.
    """
    axis = medial_axis(frames, hand, guard_start, baseline_end, cfg)
    if axis is None:
        return None
    c = cfg.segmentation
    half_window = c.hook_peak_smoothing_ms / 2
    wrist_name = f"{hand}_wrist"
    candidates: list[tuple[int, float]] = []
    for i in range(start, end):
        if wrist_name not in frames[i].image:
            continue
        timestamp = frames[i].raw.timestamp_ms
        left = i
        while left > start and timestamp - frames[left - 1].raw.timestamp_ms <= half_window:
            left -= 1
        right = i
        while right + 1 < end and frames[right + 1].raw.timestamp_ms - timestamp <= half_window:
            right += 1
        # Require temporal support on BOTH sides. An isolated final frame or a
        # gap at the apex must not become an apparently reliable peak.
        if left == i or right == i:
            continue
        window = frames[left : right + 1]
        if any(wrist_name not in f.image for f in window) or any(
            b.raw.timestamp_ms - a.raw.timestamp_ms > cfg.pose.max_gap_ms
            for a, b in zip(window, window[1:], strict=False)
        ):
            continue
        points = np.asarray([f.image[wrist_name][:2] for f in window])
        displacement = points - baseline
        if float(np.median(np.linalg.norm(displacement, axis=1))) < c.min_attempt_displacement:
            continue
        progress = float(np.median(displacement @ axis))
        if progress >= c.hook_min_medial_progress:
            candidates.append((i, progress))
    if not candidates:
        return None
    maximum_index = max(range(len(candidates)), key=lambda i: candidates[i][1])
    floor = candidates[maximum_index][1] - c.hook_peak_plateau_tolerance
    left = right = maximum_index
    while left > 0 and candidates[left - 1][0] + 1 == candidates[left][0]:
        if candidates[left - 1][1] < floor:
            break
        left -= 1
    while right + 1 < len(candidates) and candidates[right][0] + 1 == candidates[right + 1][0]:
        if candidates[right + 1][1] < floor:
            break
        right += 1
    midpoint = (
        frames[candidates[left][0]].raw.timestamp_ms + frames[candidates[right][0]].raw.timestamp_ms
    ) / 2
    return min(
        (i for i, _ in candidates[left : right + 1]),
        key=lambda i: abs(frames[i].raw.timestamp_ms - midpoint),
    )
