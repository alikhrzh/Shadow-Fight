import { cp, mkdir, access } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
await mkdir(new URL("apps/web/public/wasm/", root), { recursive: true });
await cp(
  new URL("node_modules/@mediapipe/tasks-vision/wasm/", root),
  new URL("apps/web/public/wasm/", root),
  { recursive: true },
);
await access(new URL("apps/web/public/models/pose_landmarker_full.task", root));
// MediaPipe 0.10.14's Emscripten loader uses importScripts: bundle a classic
// worker, not a module worker, consistently in development and production.
await build({
  entryPoints: [
    fileURLToPath(new URL("apps/web/src/pose/pose.worker.ts", root)),
  ],
  outfile: fileURLToPath(new URL("apps/web/public/worker/pose.js", root)),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
});
console.log(
  "Local Full model and matching MediaPipe WASM ready. No remote runtime URLs.",
);
