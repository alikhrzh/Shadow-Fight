import cfg from "../../../shared/config/defaults.json";
import {
  hands,
  other,
  emptyPhases,
  type Hand,
  type Vec,
  type Normalized,
  type Move,
  type Attempt,
} from "./types";
import { compact, distance, median, medianVec, norm, sub } from "./math";
const c = cfg.segmentation;
export const wrist = (f: Normalized, h: Hand, raw = false): Vec | undefined =>
  f[raw ? "image" : "smooth_image"][`${h}_wrist`]?.slice(0, 2);
export function speed(frames: Normalized[], i: number, h: Hand): number {
  if (!i) return 0;
  const a = wrist(frames[i - 1], h),
    b = wrist(frames[i], h),
    dt = frames[i].raw.timestamp_ms - frames[i - 1].raw.timestamp_ms;
  return !a || !b || dt <= 0 || dt > cfg.pose.max_gap_ms
    ? NaN
    : (distance(a, b) * 1000) / dt;
}
export function calibrate(
  frames: Normalized[],
  h: Hand,
): [number, number, Vec] | null {
  let anchor: Vec | undefined,
    run = 0;
  for (let end = 0; end < frames.length; end++) {
    if (
      frames[end].raw.timestamp_ms - frames[0].raw.timestamp_ms >
      c.baseline_window_ms
    )
      break;
    const p = wrist(frames[end], h, true);
    if (!p) {
      run = end + 1;
      continue;
    }
    anchor ??= p;
    if (distance(p, anchor) >= c.min_attempt_displacement) break;
    if (
      end &&
      frames[end].raw.timestamp_ms - frames[end - 1].raw.timestamp_ms >
        cfg.pose.max_gap_ms
    )
      run = end;
    let start = end;
    while (
      start > run &&
      frames[end].raw.timestamp_ms - frames[start].raw.timestamp_ms <
        c.min_calibration_ms
    )
      start--;
    if (
      frames[end].raw.timestamp_ms - frames[start].raw.timestamp_ms <
      c.min_calibration_ms
    )
      continue;
    const points = frames.slice(start, end + 1).map((f) => wrist(f, h, true));
    if (
      points.every((p): p is Vec => !!p) &&
      compact(points, c.max_calibration_spread)
    )
      return [start, end, medianVec(points)];
  }
  return null;
}
export function medialAxis(
  frames: Normalized[],
  h: Hand,
  start: number,
  end: number,
): Vec | null {
  const axes = frames.slice(start, end + 1).flatMap((f) => {
    const a = f.image[`${h}_shoulder`],
      b = f.image[`${other(h)}_shoulder`];
    return a && b ? [sub(b.slice(0, 2), a.slice(0, 2))] : [];
  });
  if (!axes.length) return null;
  const axis = medianVec(axes),
    n = norm(axis);
  return n >= cfg.pose.min_shoulder_width ? axis.map((x) => x / n) : null;
}
export function hookPeak(
  frames: Normalized[],
  h: Hand,
  start: number,
  end: number,
  guard: number,
  baseEnd: number,
  baseline: Vec,
): number | null {
  const axis = medialAxis(frames, h, guard, baseEnd);
  if (!axis) return null;
  const candidates: [number, number][] = [];
  for (let i = start; i < end; i++) {
    if (!wrist(frames[i], h, true)) continue;
    const time = frames[i].raw.timestamp_ms,
      half = c.hook_peak_smoothing_ms / 2;
    let left = i,
      right = i;
    while (left > start && time - frames[left - 1].raw.timestamp_ms <= half)
      left--;
    while (right + 1 < end && frames[right + 1].raw.timestamp_ms - time <= half)
      right++;
    if (left === i || right === i) continue;
    const window = frames.slice(left, right + 1),
      points = window.map((f) => wrist(f, h, true));
    if (
      !points.every((p): p is Vec => !!p) ||
      window.some(
        (f, j) =>
          j > 0 &&
          f.raw.timestamp_ms - window[j - 1].raw.timestamp_ms >
            cfg.pose.max_gap_ms,
      )
    )
      continue;
    const delta = points.map((p) => sub(p, baseline));
    if (median(delta.map(norm)) < c.min_attempt_displacement) continue;
    const progress = median(delta.map((d) => d[0] * axis[0] + d[1] * axis[1]));
    if (progress >= c.hook_min_medial_progress) candidates.push([i, progress]);
  }
  if (!candidates.length) return null;
  let max = 0;
  for (let i = 1; i < candidates.length; i++)
    if (candidates[i][1] > candidates[max][1]) max = i;
  const floor = candidates[max][1] - c.hook_peak_plateau_tolerance;
  let left = max,
    right = max;
  while (
    left > 0 &&
    candidates[left - 1][0] + 1 === candidates[left][0] &&
    candidates[left - 1][1] >= floor
  )
    left--;
  while (
    right + 1 < candidates.length &&
    candidates[right][0] + 1 === candidates[right + 1][0] &&
    candidates[right + 1][1] >= floor
  )
    right++;
  const mid =
    (frames[candidates[left][0]].raw.timestamp_ms +
      frames[candidates[right][0]].raw.timestamp_ms) /
    2;
  return candidates
    .slice(left, right + 1)
    .reduce((best, v) =>
      Math.abs(frames[v[0]].raw.timestamp_ms - mid) <
      Math.abs(frames[best[0]].raw.timestamp_ms - mid)
        ? v
        : best,
    )[0];
}
export function segment(
  frames: Normalized[],
  expected: Hand,
  move: Move,
): Attempt {
  const result: Attempt = {
    phases: emptyPhases(),
    active: null,
    baseline: {},
    reason: null,
    peak_method: null,
  };
  const fail = (reason: string) => ({ ...result, reason });
  if (!frames.length) return fail("no_attempt_detected");
  const times = frames.map((f) => f.raw.timestamp_ms);
  const cal: Partial<Record<Hand, [number, number, Vec]>> = {},
    radii: Partial<Record<Hand, number[]>> = {},
    candidates: Partial<Record<Hand, number>> = {};
  for (const h of hands) {
    const v = calibrate(frames, h);
    if (!v) continue;
    cal[h] = v;
    result.baseline[h] = v[2];
    radii[h] = frames.map((f) => {
      const p = wrist(f, h);
      return p ? distance(p, v[2]) : NaN;
    });
  }
  if (!Object.keys(cal).length) return fail("guard_not_found");
  for (const h of hands) {
    if (!cal[h]) continue;
    let first: number | null = null;
    const r = radii[h]!;
    for (let i = cal[h]![1] + 1; i < frames.length; i++) {
      if (!(
        Number.isFinite(r[i]) &&
        r[i] >= c.min_start_displacement &&
        speed(frames, i, h) >= c.movement_speed_threshold &&
        r[i] >= r[i - 1]
      )) {
        first = null;
        continue;
      }
      first ??= i;
      if (
        i - first + 1 >= c.confirmation_frames &&
        times[i] - times[first] >= c.confirmation_ms
      ) {
        candidates[h] = first;
        break;
      }
    }
  }
  if (!Object.keys(candidates).length)
    return fail(
      Object.keys(cal).length === 2 ? "no_attempt_detected" : "guard_not_found",
    );
  if (!cal[expected]) return fail("guard_not_found");
  const earliest = Math.min(...Object.values(candidates));
  let limit = frames.findIndex(
    (f, i) =>
      i > earliest &&
      f.raw.timestamp_ms - times[earliest] > c.max_attempt_duration_ms,
  );
  if (limit < 0) limit = frames.length;
  const amplitude = (h: Hand) =>
    candidates[h] === undefined
      ? 0
      : Math.max(
          0,
          ...radii[h]!.slice(earliest, limit).filter(Number.isFinite),
        );
  let active = candidates[expected] !== undefined ? expected : other(expected);
  if (
    candidates[other(expected)] !== undefined &&
    amplitude(other(expected)) > amplitude(expected) * c.active_hand_ratio
  )
    active = other(expected);
  const start = candidates[active]!,
    [guard, baseEnd, baseline] = cal[active]!,
    r = radii[active]!;
  let peak = start;
  for (let i = start + 1; i < limit; i++)
    if (
      (Number.isFinite(r[i]) ? r[i] : -1) >
      (Number.isFinite(r[peak]) ? r[peak] : -1)
    )
      peak = i;
  if (r[peak] < c.min_attempt_displacement) return fail("no_attempt_detected");
  result.peak_method = move === "hook" ? "hook_medial_sweep" : "radial_maximum";
  if (move === "hook") {
    const p = hookPeak(frames, active, start, limit, guard, baseEnd, baseline);
    if (p === null) return fail("hook_peak_ambiguous");
    peak = p;
  }
  if (peak - start + 1 < c.min_attempt_frames)
    return fail("no_attempt_detected");
  let returnStart: number | null = null,
    returned: number | null = null;
  const threshold = Math.min(cfg[move].max_return_distance, r[peak] * 0.35);
  for (let i = peak + 1; i < limit; i++) {
    const p = wrist(frames[i], active, true);
    if (
      p &&
      times[i] - times[i - 1] <= cfg.pose.max_gap_ms &&
      distance(p, baseline) <= threshold
    ) {
      returnStart ??= i;
      if (
        i - returnStart + 1 >= c.confirmation_frames &&
        times[i] - times[returnStart] >= c.return_hold_ms
      ) {
        const points = frames
          .slice(returnStart, i + 1)
          .map((f) => wrist(f, active, true)!);
        if (compact(points, c.max_calibration_spread)) {
          returned = i;
          break;
        }
        returnStart++;
      }
    } else returnStart = null;
  }
  result.active = active;
  result.phases = {
    guard_start_frame: guard,
    calibration_end_frame: baseEnd,
    movement_start_frame: start,
    peak_frame: peak,
    return_frame: returned,
    end_frame: returned ?? limit - 1,
  };
  return result;
}
