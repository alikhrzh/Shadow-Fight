import type { Space } from "../../../../packages/coach-core/src/types";
import { complete } from "./geometry";

/** Anatomical sides; mirroring either screen axis does not swap handedness. */
export function detectHandsUp(p: Space, holding = false): boolean {
  if (!complete(p)) return false;
  const margin = holding ? 0.32 : 0.45;
  return ["left", "right"].every(
    (h) =>
      p[`${h}_wrist`][1] < p.nose[1] - margin &&
      p[`${h}_elbow`][1] < p[`${h}_shoulder`][1] - (holding ? 0.1 : 0.2),
  );
}
