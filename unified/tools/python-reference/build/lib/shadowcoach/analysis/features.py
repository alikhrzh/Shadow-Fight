import numpy as np

from shadowcoach.analysis.geometry import angle_degrees, distance, straightness
from shadowcoach.analysis.hook_peak import medial_axis
from shadowcoach.analysis.normalization import NormalizedFrame
from shadowcoach.analysis.segmentation import Segmentation, wrist, wrist_speed
from shadowcoach.config import Config
from shadowcoach.domain.enums import Hand
from shadowcoach.domain.models import AttemptFeatures


def extract_features(
    frames: list[NormalizedFrame],
    attempt: Segmentation,
    expected: Hand,
    cfg: Config,
) -> AttemptFeatures:
    p = attempt.phases
    assert p.guard_start_frame is not None and p.movement_start_frame is not None
    assert p.peak_frame is not None and p.end_frame is not None
    assert attempt.active_hand is not None and attempt.baseline is not None
    hand = attempt.active_hand
    arm = [f"{hand}_{part}" for part in ("shoulder", "elbow", "wrist")]
    whole = frames[p.guard_start_frame : p.end_frame + 1]
    peak_window = [
        f
        for f in whole
        if abs(f.raw.timestamp_ms - frames[p.peak_frame].raw.timestamp_ms)
        <= cfg.pose.peak_window_ms
    ]
    use_world = sum(all(j in f.world for j in arm) for f in whole) / len(whole) >= (
        cfg.pose.min_world_coverage
    ) and all(all(j in f.world for j in arm) for f in peak_window)
    space = "world" if use_world else "image"

    def angle(frame: NormalizedFrame) -> float | None:
        coords = getattr(frame, space)
        if not all(j in coords for j in arm):
            return None
        # World coordinates are metric 3D. Image angles explicitly ignore inferred depth.
        points = [coords[j] if use_world else coords[j][:2] for j in arm]
        return angle_degrees(*points)

    baseline_end_ms = (
        frames[p.calibration_end_frame].raw.timestamp_ms
        if p.calibration_end_frame is not None
        else frames[p.guard_start_frame].raw.timestamp_ms + cfg.segmentation.calibration_ms
    )
    guard_window = [f for f in whole if f.raw.timestamp_ms <= baseline_end_ms]

    def median_angle(window: list[NormalizedFrame]) -> float | None:
        values = [a for f in window if (a := angle(f)) is not None]
        return float(np.median(values)) if values else None

    all_angles = [
        a for f in frames[p.movement_start_frame : p.end_frame + 1] if (a := angle(f)) is not None
    ]
    peak_wrist = wrist(frames[p.peak_frame], hand)
    assert peak_wrist is not None
    peak_img = frames[p.peak_frame].smooth_image
    axis = None
    if attempt.peak_method == "hook_medial_sweep":
        assert p.calibration_end_frame is not None
        # Peak selection uses a centered window, not a delayed EMA. Keep its
        # spatial metrics aligned with that same keyframe and anatomical axis.
        motion_window = [
            f
            for f in frames[p.movement_start_frame : p.end_frame + 1]
            if abs(f.raw.timestamp_ms - frames[p.peak_frame].raw.timestamp_ms)
            <= cfg.segmentation.hook_peak_smoothing_ms / 2
        ]
        names = set.intersection(*(set(f.image) for f in motion_window))
        peak_img = {
            name: np.median([f.image[name] for f in motion_window], axis=0) for name in names
        }
        peak_wrist = peak_img[f"{hand}_wrist"][:2]
        axis = medial_axis(frames, hand, p.guard_start_frame, p.calibration_end_frame, cfg)
    delta = peak_wrist - attempt.baseline[hand]
    other_name = f"{hand.other}_wrist"
    guard_distances = [
        (f.raw.frame, distance(f.smooth_image[other_name][:2], f.smooth_image["nose"][:2]))
        for f in frames[p.movement_start_frame : p.end_frame + 1]
        if other_name in f.smooth_image and "nose" in f.smooth_image
    ]
    worst_guard = max(guard_distances, key=lambda x: x[1]) if guard_distances else None
    peak_guard = (
        distance(peak_img[other_name][:2], peak_img["nose"][:2])
        if (other_name in peak_img and "nose" in peak_img)
        else None
    )
    rotation = None
    depth = None
    shoulder_names = ("left_shoulder", "right_shoulder")
    if sum(all(j in f.world for j in shoulder_names) for f in whole) / len(whole) >= (
        cfg.pose.min_world_coverage
    ):

        def z_proxy(window: list[NormalizedFrame]) -> float | None:
            values = [
                f.world["left_shoulder"][2] - f.world["right_shoulder"][2]
                for f in window
                if all(j in f.world for j in shoulder_names)
            ]
            return float(np.median(values)) if values else None

        start_z, end_z = z_proxy(guard_window), z_proxy(peak_window)
        if start_z is not None and end_z is not None:
            rotation = abs(end_z - start_z)
    name = f"{hand}_wrist"
    initial_depths = [f.world[name][2] for f in guard_window if name in f.world]
    peak_depths = [f.world[name][2] for f in peak_window if name in f.world]
    if initial_depths and peak_depths:
        depth = float(np.median(peak_depths) - np.median(initial_depths))
    endpoint = wrist(frames[p.end_frame], hand)
    return_distance = distance(endpoint, attempt.baseline[hand]) if endpoint is not None else None
    path = [attempt.baseline[hand]] + [
        point
        for f in frames[p.movement_start_frame : p.peak_frame + 1]
        if (point := wrist(f, hand)) is not None
    ]
    gap = None
    if f"{hand}_elbow" in peak_img and f"{hand}_shoulder" in peak_img:
        gap = max(0.0, float(peak_img[f"{hand}_elbow"][1] - peak_img[f"{hand}_shoulder"][1]))
    speeds = [
        wrist_speed(frames, i, hand, cfg.pose.max_gap_ms)
        for i in range(p.movement_start_frame, p.end_frame + 1)
    ]
    return AttemptFeatures(
        active_hand=hand,
        expected_hand=expected,
        duration_ms=frames[p.end_frame].raw.timestamp_ms
        - frames[p.movement_start_frame].raw.timestamp_ms,
        max_wrist_speed=max((s for s in speeds if np.isfinite(s)), default=0),
        wrist_displacement=float(np.linalg.norm(delta)),
        horizontal_displacement=float(delta[0]),
        medial_displacement=float(delta @ axis) if axis is not None else None,
        vertical_displacement=float(delta[1]),
        depth_displacement=depth,
        elbow_angle_start=median_angle(guard_window),
        elbow_angle_peak=median_angle(peak_window),
        elbow_angle_range=max(all_angles) - min(all_angles) if all_angles else None,
        max_elbow_angle=max(all_angles) if all_angles else None,
        other_hand_guard_distance_max=worst_guard[1] if worst_guard else None,
        other_hand_guard_distance_mean=float(np.mean([v for _, v in guard_distances]))
        if guard_distances
        else None,
        guard_distance_peak=peak_guard,
        guard_worst_frame=worst_guard[0] if worst_guard else None,
        shoulder_rotation=rotation,
        elbow_shoulder_vertical_gap=gap,
        trajectory_straightness=straightness(path),
        return_distance=return_distance,
        return_worst_frame=p.end_frame,
        returned_to_guard=p.return_frame is not None,
        pose_quality="good",
        angle_coordinate_space="world_3d" if use_world else "image_2d",
        rotation_coordinate_space="world_3d" if rotation is not None else None,
    )
