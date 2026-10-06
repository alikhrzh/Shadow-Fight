from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from shadowcoach.analysis.geometry import distance
from shadowcoach.analysis.hook_peak import select_hook_peak
from shadowcoach.analysis.normalization import NormalizedFrame
from shadowcoach.config import Config
from shadowcoach.domain.enums import Hand, Move, Phase
from shadowcoach.domain.models import Phases


@dataclass
class Segmentation:
    phases: Phases
    states: list[Phase]
    active_hand: Hand | None = None
    baseline: dict[Hand, NDArray[np.float64]] | None = None
    reason: str | None = None
    peak_method: str | None = None

    @property
    def detected(self) -> bool:
        return self.phases.movement_start_frame is not None


def wrist(frame: NormalizedFrame, hand: Hand) -> NDArray[np.float64] | None:
    p = frame.smooth_image.get(f"{hand}_wrist")
    return p[:2] if p is not None else None


def raw_wrist(frame: NormalizedFrame, hand: Hand) -> NDArray[np.float64] | None:
    p = frame.image.get(f"{hand}_wrist")
    return p[:2] if p is not None else None


def compact_window(points: list[NDArray[np.float64]], max_spread: float) -> bool:
    """Bound total spatial spread, without rejecting a one-frame speed spike."""
    array = np.asarray(points)
    return float(np.max(np.linalg.norm(array[:, None] - array[None, :], axis=2))) <= max_spread


def calibrate_hand(
    frames: list[NormalizedFrame], hand: Hand, cfg: Config
) -> tuple[int, int, NDArray[np.float64]] | None:
    """Find an initial compact wrist cluster independently of the other hand.

    A lowered/non-stationary free hand is a technique question, not a reason to
    discard calibration of a visible striking hand. Do not calibrate at the
    punch apex or after a return: stop once substantial motion has started.
    Missing points and long timestamp gaps cannot be bridged.
    """
    c = cfg.segmentation
    anchor = None
    run = 0
    for end, frame in enumerate(frames):
        if frame.raw.timestamp_ms - frames[0].raw.timestamp_ms > c.baseline_window_ms:
            break
        point = raw_wrist(frame, hand)
        if point is None:
            run = end + 1
            continue
        if anchor is None:
            anchor = point
        if distance(point, anchor) >= c.min_attempt_displacement:
            break
        if end and frame.raw.timestamp_ms - frames[end - 1].raw.timestamp_ms > cfg.pose.max_gap_ms:
            run = end
        start = end
        while start > run and (
            frame.raw.timestamp_ms - frames[start].raw.timestamp_ms < c.min_calibration_ms
        ):
            start -= 1
        if frame.raw.timestamp_ms - frames[start].raw.timestamp_ms < c.min_calibration_ms:
            continue
        points = [raw_wrist(f, hand) for f in frames[start : end + 1]]
        if all(p is not None for p in points) and compact_window(points, c.max_calibration_spread):
            return start, end, np.median(points, axis=0)
    return None


def wrist_speed(frames: list[NormalizedFrame], i: int, hand: Hand, max_gap_ms: float) -> float:
    if i == 0:
        return 0.0
    a, b = wrist(frames[i - 1], hand), wrist(frames[i], hand)
    dt = frames[i].raw.timestamp_ms - frames[i - 1].raw.timestamp_ms
    if a is None or b is None or dt <= 0 or dt > max_gap_ms:
        return float("nan")
    return distance(a, b) * 1000 / dt


def segment(
    frames: list[NormalizedFrame],
    expected: Hand,
    move: Move,
    cfg: Config,
) -> Segmentation:
    result = Segmentation(Phases(), [Phase.UNKNOWN] * len(frames))
    if not frames:
        result.reason = "no_attempt_detected"
        return result
    c = cfg.segmentation
    times = [f.raw.timestamp_ms for f in frames]
    speeds = {
        h: [wrist_speed(frames, i, h, cfg.pose.max_gap_ms) for i in range(len(frames))]
        for h in Hand
    }
    calibrations = {
        h: calibration for h in Hand if (calibration := calibrate_hand(frames, h, cfg)) is not None
    }
    if not calibrations:
        result.reason = "guard_not_found"
        return result
    baselines = {h: calibration[2] for h, calibration in calibrations.items()}
    result.baseline = baselines
    result.states = [Phase.GUARD] * len(frames)
    radii = {
        h: [
            distance(p, baselines[h]) if (p := wrist(f, h)) is not None else float("nan")
            for f in frames
        ]
        for h in calibrations
    }
    candidates: dict[Hand, int] = {}
    # Both hands must be searched, otherwise wrong-hand punches disappear entirely.
    for h, (_, baseline_end, _) in calibrations.items():
        first = None
        for i in range(baseline_end + 1, len(frames)):
            moving = (
                np.isfinite(radii[h][i])
                and radii[h][i] >= c.min_start_displacement
                and (speeds[h][i] >= c.movement_speed_threshold)
                and radii[h][i] >= radii[h][i - 1]
            )
            if not moving:
                first = None
                continue
            if first is None:
                first = i
            if (
                i - first + 1 >= c.confirmation_frames
                and times[i] - times[first] >= c.confirmation_ms
            ):
                candidates[h] = first
                break
    if not candidates:
        result.reason = (
            "no_attempt_detected" if len(calibrations) == len(Hand) else "guard_not_found"
        )
        return result
    # A moving but uncalibrated expected hand is ambiguous, not proof that a
    # swinging free hand performed a wrong-hand punch.
    if expected not in calibrations:
        result.reason = "guard_not_found"
        return result
    earliest = min(candidates.values())
    end_limit = next(
        (
            i
            for i in range(earliest + 1, len(frames))
            if times[i] - times[earliest] > c.max_attempt_duration_ms
        ),
        len(frames),
    )
    amplitudes = {
        h: max(
            (radii[h][i] for i in range(earliest, end_limit) if np.isfinite(radii[h][i])), default=0
        )
        for h in candidates
    }
    active = expected if expected in candidates else expected.other
    if expected.other in candidates and amplitudes[expected.other] > (
        amplitudes.get(expected, 0) * c.active_hand_ratio
    ):
        active = expected.other
    start = candidates[active]
    guard_start, baseline_end, _ = calibrations[active]
    peak = max(
        range(start, end_limit),
        key=lambda i: radii[active][i] if np.isfinite(radii[active][i]) else -1,
    )
    if radii[active][peak] < c.min_attempt_displacement:
        result.reason = "no_attempt_detected"
        return result
    result.peak_method = "radial_maximum"
    if move == Move.HOOK:
        result.peak_method = "hook_medial_sweep"
        hook_peak = select_hook_peak(
            frames, active, start, end_limit, guard_start, baseline_end, baselines[active], cfg
        )
        if hook_peak is None:
            result.reason = "hook_peak_ambiguous"
            return result
        peak = hook_peak
    if peak - start + 1 < c.min_attempt_frames:
        result.reason = "no_attempt_detected"
        return result
    return_start = returned = None
    # Use raw positions for return timing: an EMA keeps drifting after the real
    # hand has already settled. Require a compact, continuously visible hold.
    threshold = min(cfg.for_move(move).max_return_distance, radii[active][peak] * 0.35)
    for i in range(peak + 1, end_limit):
        point = raw_wrist(frames[i], active)
        continuous = times[i] - times[i - 1] <= cfg.pose.max_gap_ms
        if point is not None and continuous and distance(point, baselines[active]) <= threshold:
            if return_start is None:
                return_start = i
            if i - return_start + 1 >= c.confirmation_frames and (
                times[i] - times[return_start] >= c.return_hold_ms
            ):
                points = [raw_wrist(f, active) for f in frames[return_start : i + 1]]
                if compact_window(points, c.max_calibration_spread):
                    returned = i
                    break
                return_start += 1
        else:
            return_start = None
    end = returned if returned is not None else end_limit - 1
    result.active_hand = active
    result.phases = Phases(
        guard_start_frame=guard_start,
        calibration_end_frame=baseline_end,
        movement_start_frame=start,
        peak_frame=peak,
        return_frame=returned,
        end_frame=end,
    )
    for i in range(start, end + 1):
        result.states[i] = (
            Phase.START
            if i == start
            else (Phase.EXTENSION if i < peak else Phase.PEAK if i == peak else Phase.RETURN)
        )
    if returned is not None:
        result.states[returned:] = [Phase.COMPLETE] * (len(frames) - returned)
    return result
