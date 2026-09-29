import { readFileSync, writeFileSync } from "node:fs";
import { analyze } from "../packages/coach-core/src/analyze";
import { StreamCoach } from "../packages/coach-core/src/stream";
import type { Frame, VideoInfo, Move } from "../packages/coach-core/src/types";
type Replay = {
  id: string;
  move: Move;
  info: VideoInfo;
  rawFrames: Frame[];
  delegate: string;
  meanProcessingMs: number;
  maxProcessingMs: number;
  results: unknown[];
};
const cases = JSON.parse(
  readFileSync("private-data/browser-replay.json", "utf8"),
) as Replay[];
const results = cases.map((c) => {
  const report = analyze(c.rawFrames, c.info, c.move, "orthodox");
  const stream = new StreamCoach(c.move, "orthodox"),
    events = [];
  for (const f of c.rawFrames) {
    const update = stream.push(f, c.info.width, c.info.height);
    if (update.result) events.push(update.result.status);
  }
  const xs = c.rawFrames
    .map((f) => f.landmarks.left_wrist?.x)
    .filter(Number.isFinite);
  return {
    id: c.id,
    delegate: c.delegate,
    frameCount: c.rawFrames.length,
    wristRange: xs.length ? Math.max(...xs) - Math.min(...xs) : null,
    batchStatus: report.status,
    batchScore: report.score,
    issues: report.quality.issues.map((i) => i.code),
    violations: report.violations.map((v) => v.code),
    streamEvents: events,
    meanProcessingMs: c.meanProcessingMs,
    maxProcessingMs: c.maxProcessingMs,
    confidenceMode: report.confidence_mode,
  };
});
writeFileSync(
  "private-data/browser-summary.json",
  JSON.stringify(results, null, 2),
);
console.table(
  results.map(
    ({ id, batchStatus, batchScore, streamEvents, meanProcessingMs }) => ({
      id,
      batchStatus,
      batchScore,
      streamEvents: streamEvents.join(","),
      meanMs: Math.round(meanProcessingMs),
    }),
  ),
);
