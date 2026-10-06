import { normalize } from "../../../../packages/coach-core/src/normalize";
import { distance } from "../../../../packages/coach-core/src/math";
import {
  hands,
  other,
  type Frame,
  type Space,
} from "../../../../packages/coach-core/src/types";

/** Reuse the core's visibility and aspect-corrected shoulder normalization. */
export function body(frame: Frame, width: number, height: number): Space {
  if (frame.pose_count !== 1 || width <= 0 || height <= 0) return {};
  return normalize([frame], {
    width,
    height,
    fps: 30,
    frame_count: 1,
    duration_ms: 0,
  })[0].image;
}
export const armJoints = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
];
export const complete = (p: Space) => armJoints.every((k) => p[k]);
export const gap = (a: number[], b: number[]) =>
  distance(a.slice(0, 2), b.slice(0, 2));
export function guardVisible(p: Space): boolean {
  return (
    complete(p) &&
    hands.every(
      (h) =>
        gap(p[`${h}_wrist`], p.nose) < 0.95 &&
        // A compact X is not a boxing guard. Keep each wrist nearer its own
        // shoulder (allowing a small central overlap), regardless of mirroring.
        gap(p[`${h}_wrist`], p[`${h}_shoulder`]) <=
          gap(p[`${h}_wrist`], p[`${other(h)}_shoulder`]) + 0.15 &&
        p[`${h}_wrist`][1] > p.nose[1] - 0.25 &&
        p[`${h}_elbow`][1] > p[`${h}_shoulder`][1] - 0.2,
    )
  );
}
