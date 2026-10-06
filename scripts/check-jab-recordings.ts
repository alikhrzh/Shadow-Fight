/** Local, deterministic replay of saved observations, not live-camera inference.
 * node --import tsx scripts/check-jab-recordings.ts BASELINE_DIR [NEW_OUTPUT.json]
 * An output file must not already exist. Originals/baseline are never overwritten.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import {
  AttemptController,
  type CaptureMode,
} from "../apps/web/src/training/attemptController";
import { normalize, visible } from "../packages/coach-core/src/normalize";
import {
  keyJoints,
  type Frame,
  type Report,
  type Stance,
  type VideoInfo,
} from "../packages/coach-core/src/types";

const directory = process.argv[2];
if (!directory)
  throw Error(
    "Pass a private baseline directory containing annotations.json and *.frames.json",
  );
const read = (name: string) =>
  JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const annotations = read("annotations.json");
const stance = annotations.stance as Stance;
assert.ok(stance === "orthodox" || stance === "southpaw");
const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
interface Recording {
  rawFrames: Frame[];
  info: VideoInfo;
}
interface Event {
  emitted_ms: number;
  report: Report;
}
function replay(data: Recording, frames: Frame[], rearm: boolean) {
  const c = new AttemptController("jab", stance),
    events: Event[] = [];
  let mode: CaptureMode = "calibrate",
    id = 1,
    calibratedAt: number | null = null,
    maxBuffer = 0;
  for (const f of frames) {
    const u = c.push(
      f,
      data.info.width,
      data.info.height,
      mode,
      `diagnostic-${id}`,
    );
    maxBuffer = Math.max(maxBuffer, u.bufferSize);
    if (mode === "calibrate" && u.phase === "ready") {
      mode = "capture";
      calibratedAt ??= f.timestamp_ms;
    }
    if (u.result) {
      events.push({ emitted_ms: f.timestamp_ms, report: u.result });
      if (rearm) {
        mode = "calibrate";
        id++;
      }
    }
  }
  return { events, calibratedAt, maxBuffer };
}
function missingStats(frames: Frame[]) {
  return Object.fromEntries(
    keyJoints.map((k) => {
      let since: number | null = null,
        longestMs = 0;
      for (const f of frames) {
        if (!visible(f.landmarks[k])) {
          since ??= f.timestamp_ms;
          longestMs = Math.max(longestMs, f.timestamp_ms - since);
        } else since = null;
      }
      const bad = frames.filter((f) => !visible(f.landmarks[k]));
      return [
        k,
        {
          totalFrames: frames.length,
          rejectedFrames: bad.length,
          longestMissingSpanMs: longestMs,
          lowVisibilityFrames: bad.filter(
            (f) => (f.landmarks[k]?.visibility ?? 0) < 0.5,
          ).length,
          outsideImageFrames: bad.filter((f) => {
            const p = f.landmarks[k];
            return p && (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
          }).length,
        },
      ];
    }),
  );
}
const jab = read("jeb10times.frames.json") as Recording;
const windows = annotations.punches.jeb10times.attempts as [
  number,
  number,
  number,
][];
const attempts = windows.map(([start, peak, end], i) => {
  const frames = jab.rawFrames.filter(
    (f) =>
      f.timestamp_ms >= (start - 3) * 1000 &&
      f.timestamp_ms <= (end + 2) * 1000,
  );
  const result = replay(jab, frames, false);
  const event = result.events[0],
    capture = event?.report.capture;
  const visibleWindow = jab.rawFrames.filter(
    (f) => f.timestamp_ms >= start * 1000 && f.timestamp_ms <= end * 1000,
  );
  const local = frames
    .filter(
      (f) =>
        !capture ||
        (f.timestamp_ms >= capture.onset_ms - 700 &&
          f.timestamp_ms <= capture.end_ms),
    )
    .map((f, i) => ({ ...f, frame: i }));
  const normal = normalize(local, {
    ...jab.info,
    frame_count: local.length,
    duration_ms: local.at(-1)!.timestamp_ms - local[0].timestamp_ms,
  });
  const scaleRejected = normal.filter(
    (f) =>
      f.raw.timestamp_ms >= start * 1000 &&
      f.raw.timestamp_ms <= end * 1000 &&
      visible(f.raw.landmarks.left_shoulder) &&
      visible(f.raw.landmarks.right_shoulder) &&
      !f.image.left_shoulder,
  ).length;
  return {
    id: i + 1,
    manual: { start, peak, end },
    matched:
      !!capture &&
      capture.peak_ms >= (start - 0.2) * 1000 &&
      capture.peak_ms <= (end + 0.2) * 1000,
    completeBoundary: capture?.termination === "returned",
    onsetOffsetSeconds: capture ? capture.onset_ms / 1000 - start : null,
    endOffsetSeconds: capture ? capture.end_ms / 1000 - end : null,
    observations: {
      missing: missingStats(visibleWindow),
      scaleRejectedFrames: scaleRejected,
      ambiguousPeopleFrames: visibleWindow.filter((f) => f.pose_count !== 1)
        .length,
    },
    ...result,
  };
});
const stress = ["jeb10times", "handup", "handcross", "freemotions"].map(
  (id) => {
    const data = read(`${id}.frames.json`) as Recording;
    const r = replay(data, data.rawFrames, true);
    const unmatched =
      id === "jeb10times"
        ? r.events.filter(
            (e) =>
              !windows.some(
                ([s, , end]) =>
                  e.report.capture &&
                  e.report.capture.peak_ms >= (s - 0.2) * 1000 &&
                  e.report.capture.peak_ms <= (end + 0.2) * 1000,
              ),
          )
        : r.events;
    return { id, ...r, unmatched };
  },
);
const output = {
  createdAt: new Date().toISOString(),
  method: {
    stance,
    mirrored: annotations.mirrored,
    annotationUncertaintySeconds: 0.2,
    isolated:
      "Actual AttemptController; calibrate from 3s before visual onset; capture through return+2s; no distance/FPS/light or gesture UI gate.",
    matching:
      "Captured peak must lie within annotated motion +/-0.2s. Return confirmation adds hold/smoothing latency; onset and end offsets are reported, not treated as exact truth.",
    stress:
      "Automatic diagnostic rearming after each output, always requiring guard again. This intentionally bypasses the application's user-command requirement.",
    limitations: [
      "One participant, one recording session; development data, not held-out accuracy",
      "Intent labels are not trainer-certified technique labels",
      "No re-inference or live camera test",
      "Capture boundaries do not imply enough reliable points for a score",
    ],
  },
  provenance: Object.fromEntries(
    [
      ["observations", path.join(directory, "jeb10times.frames.json")],
      ["annotations", path.join(directory, "annotations.json")],
      ["capture", "apps/web/src/training/jabCapture.ts"],
      ["punchCapture", "apps/web/src/training/punchCapture.ts"],
      ["controller", "apps/web/src/training/attemptController.ts"],
      ["normalization", "packages/coach-core/src/normalize.ts"],
      ["analysis", "packages/coach-core/src/analyze.ts"],
      ["scoring", "packages/coach-core/src/evaluate.ts"],
      ["thresholds", "shared/config/defaults.json"],
    ].map(([name, file]) => [name, { file, sha256: sha(file) }]),
  ),
  summary: {
    annotated: attempts.length,
    matched: attempts.filter((a) => a.matched).length,
    completeBoundaries: attempts.filter((a) => a.matched && a.completeBoundary)
      .length,
    scored: attempts.filter((a) => a.events[0]?.report.status === "completed")
      .length,
    rejected: attempts.filter(
      (a) => a.events[0]?.report.status === "unreliable",
    ).length,
    missing: attempts.filter((a) => !a.events.length).length,
    stress: stress.map((r) => ({
      id: r.id,
      outputs: r.events.length,
      unmatched: r.unmatched.length,
      maxBuffer: r.maxBuffer,
    })),
  },
  attempts,
  stress,
};
if (process.argv[3])
  writeFileSync(process.argv[3], JSON.stringify(output, null, 2), {
    flag: "wx",
  });
console.log(JSON.stringify(output.summary, null, 2));
assert.ok(
  attempts.every((a) => a.events.length <= 1),
  "at most one report per commanded attempt",
);
assert.ok(
  attempts.every((a) =>
    a.events.every(
      (e) => e.report.status === "completed" || e.report.score === null,
    ),
  ),
);
assert.ok(
  stress.every((s) => s.maxBuffer <= 512),
  "bounded state",
);
