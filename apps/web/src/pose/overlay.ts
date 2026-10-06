import type { Frame, Point } from "../../../../packages/coach-core/src/types";
import { visible } from "../../../../packages/coach-core/src/normalize";
const connections = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["right_hip", "right_knee"],
  ["left_knee", "left_ankle"],
  ["right_knee", "right_ankle"],
];
/** Same object-fit: contain transform for video and canvas; no inferred depth in display. */
export function mapPoint(
  p: Point,
  sourceW: number,
  sourceH: number,
  width: number,
  height: number,
  mirror: boolean,
) {
  const scale = Math.min(width / sourceW, height / sourceH),
    w = sourceW * scale,
    h = sourceH * scale;
  return {
    x: (width - w) / 2 + (mirror ? 1 - p.x : p.x) * w,
    y: (height - h) / 2 + p.y * h,
  };
}
export function drawOverlay(
  canvas: HTMLCanvasElement,
  frame: Frame,
  sourceW: number,
  sourceH: number,
  mirror: boolean,
  highlight: string[] = [],
) {
  const { width, height } = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (frame.pose_count !== 1) return;
  const mapped = Object.fromEntries(
    Object.entries(frame.landmarks)
      .filter(([, p]) => visible(p))
      .map(([k, p]) => [
        k,
        mapPoint(p, sourceW, sourceH, width, height, mirror),
      ]),
  );
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#c7ff4a";
  ctx.fillStyle = "#f0ffd6";
  for (const [a, b] of connections) {
    if (!mapped[a] || !mapped[b]) continue;
    ctx.strokeStyle =
      highlight.includes(a) || highlight.includes(b) ? "#ff9d80" : "#c7ff4a";
    ctx.beginPath();
    ctx.moveTo(mapped[a].x, mapped[a].y);
    ctx.lineTo(mapped[b].x, mapped[b].y);
    ctx.stroke();
  }
  for (const [name, p] of Object.entries(mapped)) {
    if (name.includes("eye") || name.includes("ear") || name.includes("mouth"))
      continue;
    ctx.fillStyle = highlight.includes(name) ? "#ff9d80" : "#f0ffd6";
    ctx.beginPath();
    ctx.arc(p.x, p.y, name.includes("wrist") ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
