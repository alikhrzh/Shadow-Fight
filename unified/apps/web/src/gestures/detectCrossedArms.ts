import type { Space } from "../../../../packages/coach-core/src/types";
import { complete, gap } from "./geometry";

const orient = (a: number[], b: number[], c: number[]) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function detectCrossedArms(p: Space, holding = false): boolean {
  if (!complete(p)) return false;
  const a = p.left_elbow,
    b = p.left_wrist,
    c = p.right_elbow,
    d = p.right_wrist;
  const reach = holding ? 0.65 : 0.52;
  // Strict intersection excludes parallel forearms and touching/collinear segments.
  const cross =
    orient(a, b, c) * orient(a, b, d) < -0.0001 &&
    orient(c, d, a) * orient(c, d, b) < -0.0001;
  return (
    cross &&
    gap(b, p.right_shoulder) < reach &&
    gap(d, p.left_shoulder) < reach &&
    b[1] > p.nose[1] + 0.1 &&
    d[1] > p.nose[1] + 0.1 &&
    a[1] > p.left_shoulder[1] &&
    c[1] > p.right_shoulder[1]
  );
}
