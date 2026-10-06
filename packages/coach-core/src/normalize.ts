import cfg from "../../../shared/config/defaults.json";
import type { Frame, Point, VideoInfo, Normalized, Space } from "./types";
import { distance, median, sub } from "./math";
// Web Tasks exposes visibility but not per-landmark presence. Only the explicit
// adapter marker enables visibility-only checking; unknown missing confidence
// is rejected, and an explicit low presence is NEVER overridden.
export function visible(p: Point | undefined, image = true): boolean {
  return (
    !!p &&
    [p.x, p.y, p.z].every(Number.isFinite) &&
    (p.visibility ?? 0) >= cfg.pose.min_visibility &&
    (p.presence !== undefined
      ? p.presence >= cfg.pose.min_presence
      : p.presence_unavailable === true) &&
    (!image || (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1))
  );
}
export function normalize(
  frames: Frame[],
  info: VideoInfo,
  options: { allowImageForeshortening?: boolean } = {},
): Normalized[] {
  if (!frames.length) return [];
  const widths: number[] = [],
    worldWidths: number[] = [];
  const result: Normalized[] = frames.map((raw) => {
    const image: Space = {},
      world: Space = {};
    for (const [k, p] of Object.entries(raw.landmarks))
      if (raw.pose_count === 1 && visible(p))
        image[k] = [p.x, (p.y * info.height) / info.width, p.z];
    for (const [k, p] of Object.entries(raw.world_landmarks))
      if (k in image && visible(p, false)) world[k] = [p.x, p.y, p.z];
    if (
      raw.timestamp_ms - frames[0].timestamp_ms <=
      cfg.segmentation.calibration_ms
    ) {
      if (image.left_shoulder && image.right_shoulder)
        widths.push(
          distance(
            image.left_shoulder.slice(0, 2),
            image.right_shoulder.slice(0, 2),
          ),
        );
      if (world.left_shoulder && world.right_shoulder)
        worldWidths.push(distance(world.left_shoulder, world.right_shoulder));
    }
    return { raw, image, world, smooth_image: {}, smooth_world: {} };
  });
  const scales = {
    image: widths.length ? median(widths) : 0,
    world: worldWidths.length ? median(worldWidths) : 0,
  };
  const histories: { image: Space; world: Space } = { image: {}, world: {} };
  let previous: number | null = null;
  for (const f of result) {
    const dt =
      previous === null
        ? 1000 / cfg.pose.reference_fps
        : f.raw.timestamp_ms - previous;
    const alpha =
      1 -
      (1 - cfg.pose.smoothing_alpha) ** ((dt * cfg.pose.reference_fps) / 1000);
    for (const space of ["image", "world"] as const) {
      const points = f[space],
        scale = scales[space],
        a = points.left_shoulder,
        b = points.right_shoulder;
      f[space] = {};
      if (a && b && scale >= cfg.pose.min_shoulder_width) {
        const current =
          distance(
            space === "image" ? a.slice(0, 2) : a,
            space === "image" ? b.slice(0, 2) : b,
          ) / scale;
        if (
          // Capture may follow a turning torso using the frozen guard scale.
          // Grading keeps the original scale-ratio rejection, by default.
          (current >= 1 / cfg.pose.max_shoulder_scale_ratio ||
            (space === "image" &&
              options.allowImageForeshortening === true &&
              current > Number.EPSILON)) &&
          current <= cfg.pose.max_shoulder_scale_ratio
        ) {
          const center = a.map((x, i) => (x + b[i]) / 2);
          f[space] = Object.fromEntries(
            Object.entries(points).map(([k, p]) => [
              k,
              sub(p, center).map((x) => x / scale),
            ]),
          );
        }
      }
      const history = dt <= cfg.pose.max_gap_ms ? histories[space] : {};
      const smooth: Space = Object.fromEntries(
        Object.entries(f[space]).map(([k, p]) => [
          k,
          history[k]
            ? p.map((x, i) => alpha * x + (1 - alpha) * history[k][i])
            : [...p],
        ]),
      );
      f[space === "image" ? "smooth_image" : "smooth_world"] = smooth;
      histories[space] = smooth;
    }
    previous = f.raw.timestamp_ms;
  }
  return result;
}
