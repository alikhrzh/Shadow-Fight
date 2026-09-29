import type { Vec, Space } from "./types";
export const sub = (a: Vec, b: Vec): Vec => a.map((x, i) => x - b[i]);
export const norm = (v: Vec): number => Math.hypot(...v);
export const distance = (a: Vec, b: Vec): number => norm(sub(a, b));
export const clamp = (x: number): number => Math.max(0, Math.min(1, x));
export const mean = (v: number[]): number =>
  v.reduce((a, b) => a + b, 0) / v.length;
export function median(v: number[]): number {
  const a = [...v].sort((a, b) => a - b);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
export const medianVec = (v: Vec[]): Vec =>
  v[0].map((_, i) => median(v.map((p) => p[i])));
export function angle(a: Vec, b: Vec, c: Vec): number | null {
  const u = sub(a, b),
    v = sub(c, b),
    d = norm(u) * norm(v);
  return !Number.isFinite(d) || d < 1e-9
    ? null
    : (Math.acos(
        Math.max(-1, Math.min(1, u.reduce((s, x, i) => s + x * v[i], 0) / d)),
      ) *
        180) /
        Math.PI;
}
export function straightness(v: Vec[]): number | null {
  if (v.length < 2) return null;
  const path = v.slice(1).reduce((s, p, i) => s + distance(p, v[i]), 0);
  return path > 1e-9 ? Math.min(1, distance(v[0], v.at(-1)!) / path) : null;
}
export const compact = (points: Vec[], limit: number): boolean =>
  points.every((a) => points.every((b) => distance(a, b) <= limit));
export function medianSpace(spaces: Space[]): Space {
  if (!spaces.length) return {};
  return Object.fromEntries(
    Object.keys(spaces[0])
      .filter((k) => spaces.every((s) => k in s))
      .map((k) => [k, medianVec(spaces.map((s) => s[k]))]),
  );
}
// Python round() uses ties-to-even, unlike Math.round().
export function roundEven(x: number): number {
  const floor = Math.floor(x),
    f = x - floor;
  return f === 0.5 ? floor + (floor % 2) : Math.round(x);
}
