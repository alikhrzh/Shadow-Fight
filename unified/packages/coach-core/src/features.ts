import cfg from "../../../shared/config/defaults.json";
import {
  other,
  type Normalized,
  type Attempt,
  type Hand,
  type Metrics,
  type Space,
  type Vec,
} from "./types";
import {
  angle,
  distance,
  median,
  medianSpace,
  norm,
  straightness,
  sub,
  mean,
} from "./math";
import { medialAxis, speed, wrist } from "./segment";
export function features(
  frames: Normalized[],
  a: Attempt,
  expected: Hand,
): Metrics {
  const p = a.phases,
    h = a.active!,
    start = p.movement_start_frame!,
    peak = p.peak_frame!,
    end = p.end_frame!;
  const arm = [`${h}_shoulder`, `${h}_elbow`, `${h}_wrist`],
    whole = frames.slice(p.guard_start_frame!, end + 1);
  const peakWindow = whole.filter(
    (f) =>
      Math.abs(f.raw.timestamp_ms - frames[peak].raw.timestamp_ms) <=
      cfg.pose.peak_window_ms,
  );
  const useWorld =
    whole.filter((f) => arm.every((k) => k in f.world)).length / whole.length >=
      cfg.pose.min_world_coverage &&
    peakWindow.every((f) => arm.every((k) => k in f.world));
  const elbow = (f: Normalized): number | null => {
    const s = useWorld ? f.world : f.image;
    if (!arm.every((k) => k in s)) return null;
    const points = arm.map((k) => (useWorld ? s[k] : s[k].slice(0, 2)));
    return angle(points[0], points[1], points[2]);
  };
  const medAngle = (window: Normalized[]) => {
    const v = window.map(elbow).filter((v): v is number => v !== null);
    return v.length ? median(v) : null;
  };
  const guard = whole.filter(
    (f) =>
      f.raw.timestamp_ms <= frames[p.calibration_end_frame!].raw.timestamp_ms,
  );
  const allAngles = frames
    .slice(start, end + 1)
    .map(elbow)
    .filter((v): v is number => v !== null);
  let peakWrist = wrist(frames[peak], h)!,
    peakImg: Space = frames[peak].smooth_image,
    axis: Vec | null = null;
  if (a.peak_method === "hook_medial_sweep") {
    const window = frames
      .slice(start, end + 1)
      .filter(
        (f) =>
          Math.abs(f.raw.timestamp_ms - frames[peak].raw.timestamp_ms) <=
          cfg.segmentation.hook_peak_smoothing_ms / 2,
      );
    peakImg = medianSpace(window.map((f) => f.image));
    peakWrist = peakImg[`${h}_wrist`].slice(0, 2);
    axis = medialAxis(
      frames,
      h,
      p.guard_start_frame!,
      p.calibration_end_frame!,
    );
  }
  const delta = sub(peakWrist, a.baseline[h]!),
    otherName = `${other(h)}_wrist`;
  const guardDistances = frames
    .slice(start, end + 1)
    .flatMap((f) =>
      f.smooth_image[otherName] && f.smooth_image.nose
        ? [
            [
              f.raw.frame,
              distance(
                f.smooth_image[otherName].slice(0, 2),
                f.smooth_image.nose.slice(0, 2),
              ),
            ],
          ]
        : [],
    );
  const worst = guardDistances.length
    ? guardDistances.reduce((a, b) => (b[1] > a[1] ? b : a))
    : null;
  let rotation: number | null = null;
  const shoulders = ["left_shoulder", "right_shoulder"];
  if (
    whole.filter((f) => shoulders.every((k) => k in f.world)).length /
      whole.length >=
    cfg.pose.min_world_coverage
  ) {
    const proxy = (window: Normalized[]) => {
      const z = window
        .filter((f) => shoulders.every((k) => k in f.world))
        .map((f) => f.world.left_shoulder[2] - f.world.right_shoulder[2]);
      return z.length ? median(z) : null;
    };
    const before = proxy(guard),
      after = proxy(peakWindow);
    if (before !== null && after !== null) rotation = Math.abs(after - before);
  }
  const name = `${h}_wrist`,
    initialDepth = guard.flatMap((f) =>
      f.world[name] ? [f.world[name][2]] : [],
    ),
    peakDepth = peakWindow.flatMap((f) =>
      f.world[name] ? [f.world[name][2]] : [],
    );
  const endpoint = wrist(frames[end], h),
    path = [
      a.baseline[h]!,
      ...frames
        .slice(start, peak + 1)
        .map((f) => wrist(f, h))
        .filter((p): p is Vec => !!p),
    ];
  const speeds = frames
    .slice(start, end + 1)
    .map((_, i) => speed(frames, start + i, h))
    .filter(Number.isFinite);
  return {
    active_hand: h,
    expected_hand: expected,
    duration_ms: frames[end].raw.timestamp_ms - frames[start].raw.timestamp_ms,
    max_wrist_speed: Math.max(0, ...speeds),
    wrist_displacement: norm(delta),
    horizontal_displacement: delta[0],
    medial_displacement: axis ? delta[0] * axis[0] + delta[1] * axis[1] : null,
    vertical_displacement: delta[1],
    depth_displacement:
      initialDepth.length && peakDepth.length
        ? median(peakDepth) - median(initialDepth)
        : null,
    elbow_angle_start: medAngle(guard),
    elbow_angle_peak: medAngle(peakWindow),
    elbow_angle_range: allAngles.length
      ? Math.max(...allAngles) - Math.min(...allAngles)
      : null,
    max_elbow_angle: allAngles.length ? Math.max(...allAngles) : null,
    other_hand_guard_distance_max: worst?.[1] ?? null,
    other_hand_guard_distance_mean: guardDistances.length
      ? mean(guardDistances.map((v) => v[1]))
      : null,
    guard_distance_peak:
      peakImg[otherName] && peakImg.nose
        ? distance(peakImg[otherName].slice(0, 2), peakImg.nose.slice(0, 2))
        : null,
    guard_worst_frame: worst?.[0] ?? null,
    shoulder_rotation: rotation,
    elbow_shoulder_vertical_gap:
      peakImg[`${h}_elbow`] && peakImg[`${h}_shoulder`]
        ? Math.max(0, peakImg[`${h}_elbow`][1] - peakImg[`${h}_shoulder`][1])
        : null,
    trajectory_straightness: straightness(path),
    return_distance: endpoint ? distance(endpoint, a.baseline[h]!) : null,
    return_worst_frame: end,
    returned_to_guard: p.return_frame !== null,
    pose_quality: "good",
    angle_coordinate_space: useWorld ? "world_3d" : "image_2d",
    rotation_coordinate_space: rotation !== null ? "world_3d" : null,
    motion_coordinate_space: "aspect_corrected_image_2d",
  };
}
