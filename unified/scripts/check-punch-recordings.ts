/** Local observations replay, not live-camera or technique-accuracy evaluation.
 * node --import tsx scripts/check-punch-recordings.ts BASELINE_DIR NEW_OUTPUT.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import {
  AttemptController,
  type CaptureMode,
} from "../apps/web/src/training/attemptController";
import type {
  Frame,
  Move,
  Stance,
  VideoInfo,
  Report,
} from "../packages/coach-core/src/types";
const directory = process.argv[2],
  outputPath = process.argv[3];
if (!directory || !outputPath)
  throw Error("Pass baseline directory and a new output JSON path");
const read = (name: string) =>
  JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const annotations = read("annotations.json") as {
  stance: Stance;
  mirrored: boolean;
  punches: Record<string, { move: Move; attempts: [number, number, number][] }>;
};
assert.ok(["orthodox", "southpaw"].includes(annotations.stance));
interface Recording {
  rawFrames: Frame[];
  info: VideoInfo;
}
function replay(data: Recording, frames: Frame[], move: Move, rearm: boolean) {
  const controller = new AttemptController(move, annotations.stance);
  let mode: CaptureMode = "calibrate",
    id = 1,
    calibratedAt: number | null = null,
    maxBuffer = 0;
  const events: { emitted_ms: number; report: Report }[] = [];
  for (const frame of frames) {
    const update = controller.push(
      frame,
      data.info.width,
      data.info.height,
      mode,
      String(id),
    );
    if (update.phase === "ready") {
      mode = "capture";
      calibratedAt ??= frame.timestamp_ms;
    }
    maxBuffer = Math.max(maxBuffer, update.bufferSize);
    if (update.result) {
      events.push({ emitted_ms: frame.timestamp_ms, report: update.result });
      if (rearm) {
        id++;
        mode = "calibrate";
      }
    }
  }
  assert.ok(maxBuffer <= 512);
  if (!rearm) assert.ok(events.length <= 1);
  for (const { report } of events) {
    assert.ok(report.status === "completed" || report.score === null);
    if (report.capture) {
      const c = report.capture;
      assert.ok(c.onset_ms <= c.peak_ms && c.peak_ms <= c.end_ms);
    }
  }
  return { events, calibratedAt, maxBuffer };
}
const results = Object.entries(annotations.punches).map(
  ([id, { move, attempts }]) => {
    const data = read(`${id}.frames.json`) as Recording;
    const isolated = attempts.map(([start, peak, end], i) => {
      const result = replay(
        data,
        data.rawFrames.filter(
          (f) =>
            f.timestamp_ms >= (start - 3) * 1000 &&
            f.timestamp_ms <= (end + 2) * 1000,
        ),
        move,
        false,
      );
      const capture = result.events[0]?.report.capture;
      return {
        id: i + 1,
        manual: { start, peak, end },
        matched:
          !!capture &&
          capture.peak_ms >= (start - 0.2) * 1000 &&
          capture.peak_ms <= (end + 0.2) * 1000,
        ...result,
      };
    });
    const stress = replay(data, data.rawFrames, move, true);
    const unmatched = stress.events.filter(
      (e) =>
        !attempts.some(
          ([s, , end]) =>
            e.report.capture &&
            e.report.capture.peak_ms >= (s - 0.2) * 1000 &&
            e.report.capture.peak_ms <= (end + 0.2) * 1000,
        ),
    );
    const negatives = ["handup", "handcross", "freemotions"].map((id) => {
      const d = read(`${id}.frames.json`) as Recording;
      return { id, ...replay(d, d.rawFrames, move, true) };
    });
    return {
      id,
      move,
      summary: {
        annotated: attempts.length,
        matched: isolated.filter((a) => a.matched).length,
        returned: isolated.filter(
          (a) =>
            a.matched &&
            a.events[0]?.report.capture?.termination === "returned",
        ).length,
        scored: isolated.filter(
          (a) => a.matched && a.events[0]?.report.status === "completed",
        ).length,
        rejected: isolated.filter(
          (a) => a.events[0]?.report.status === "unreliable",
        ).length,
        missing: isolated.filter((a) => !a.events.length).map((a) => a.id),
        stressOutputs: stress.events.length,
        stressUnmatched: unmatched.length,
        negativeOutputs: Object.fromEntries(
          negatives.map((n) => [n.id, n.events.length]),
        ),
      },
      isolated,
      stress,
      unmatched,
      negatives,
    };
  },
);
const inputs = [
  "annotations.json",
  ...Object.keys(annotations.punches).map((id) => `${id}.frames.json`),
  "handup.frames.json",
  "handcross.frames.json",
  "freemotions.frames.json",
].map((name) => path.join(directory, name));
const sources = [
  "apps/web/src/training/punchCapture.ts",
  "apps/web/src/training/attemptController.ts",
  "packages/coach-core/src/normalize.ts",
  "packages/coach-core/src/analyze.ts",
  "packages/coach-core/src/evaluate.ts",
  "packages/coach-core/src/segment.ts",
  "shared/config/defaults.json",
];
const provenance = [...inputs, ...sources].map((file) => ({
  file,
  sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
}));
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      method: {
        stance: annotations.stance,
        mirrored: annotations.mirrored,
        isolated:
          "Actual controller; guard calibration from onset-3s to return+2s; no UI distance/light/FPS/gesture gate.",
        stress:
          "Automatic diagnostic rearming after each result; not automatic retry in the app.",
        matching:
          "Capture peak inside manual intent interval +/-0.2s. Not expert-labelled technique accuracy or independent validation.",
        model:
          "Saved observations only; no new model inference or physical camera.",
      },
      provenance,
      results,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    results.map((r) => ({ move: r.move, ...r.summary })),
    null,
    2,
  ),
);
