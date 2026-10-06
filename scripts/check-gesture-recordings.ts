/** Private, deterministic regression on saved browser landmarks. Does not
 * modify the baseline, load videos, call NVIDIA or exercise live-camera FPS.
 * Usage: node --import tsx scripts/check-gesture-recordings.ts BASELINE_DIR
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  cameraQuality,
  gestureCameraQuality,
} from "../apps/web/src/training/cameraQuality";
import { body } from "../apps/web/src/gestures/geometry";
import { detectHandsUp } from "../apps/web/src/gestures/detectHandsUp";
import { detectCrossedArms } from "../apps/web/src/gestures/detectCrossedArms";
import { emptyHold, gestureHold } from "../apps/web/src/gestures/gestureHold";
import {
  startAllowed,
  exitGestureAllowed,
  type TrainingState,
} from "../apps/web/src/training/trainingMachine";
import type { Frame } from "../packages/coach-core/src/types";

const directory = process.argv[2];
if (!directory)
  throw Error(
    "Pass a private baseline directory containing annotations.json and *.frames.json",
  );
const read = (name: string) =>
  JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const annotations = read("annotations.json");
const contexts: TrainingState[] = [
  "waiting_for_start_gesture",
  "result",
  "ai_analysis",
];
const ids = [
  ...Object.keys(annotations.gestures),
  ...Object.keys(annotations.punches),
  annotations.negative.file,
];
const results = [];
for (const id of ids) {
  const data = read(`${id}.frames.json`);
  const { width, height } = data.info;
  const rows = [];
  for (const context of contexts) {
    const replay = (old: boolean) => {
      let up = emptyHold(),
        cross = emptyHold(),
        goodSince: number | null = null;
      const upEvents: number[] = [],
        crossEvents: number[] = [];
      for (const f of data.rawFrames as Frame[]) {
        const t = f.timestamp_ms;
        const dark =
          (data.frameChecks[
            Math.min(Math.floor(t / 1000), data.frameChecks.length - 1)
          ]?.luma ?? 255) < 24;
        const problem = old
          ? cameraQuality(f, 30, dark)
          : gestureCameraQuality(f, 30, dark, width, height);
        if (problem) goodSince = null;
        else goodSince ??= t;
        const positionReady =
          context !== "waiting_for_start_gesture" ||
          (goodSince !== null && t - goodSince >= 350);
        const allowed = old ? context !== "ai_analysis" : startAllowed(context);
        const p = body(f, width, height);
        const u = gestureHold(
          up,
          allowed && positionReady && !problem && detectHandsUp(p, up.held > 0),
          t,
          950,
        );
        const c = gestureHold(
          cross,
          exitGestureAllowed(context) && detectCrossedArms(p, cross.held > 0),
          t,
          1350,
        );
        up = u.state;
        cross = c.state;
        if (u.fired) upEvents.push(t / 1000);
        if (c.fired) crossEvents.push(t / 1000);
      }
      return { upEvents, crossEvents };
    };
    const before = replay(true),
      after = replay(false);
    assert.deepEqual(
      after.crossEvents,
      before.crossEvents,
      "exit gesture must not change",
    );
    if (id === "handup") {
      const windows = annotations.gestures.handup.event_windows_s as [
        number,
        number,
      ][];
      assert.equal(after.upEvents.length, windows.length, context);
      for (const [start, end] of windows)
        assert.equal(
          after.upEvents.filter((t) => t >= start && t <= end).length,
          1,
          `${context}: ${start}-${end}`,
        );
    } else
      assert.equal(
        after.upEvents.length,
        0,
        `${id}: false start in ${context}`,
      );
    if (id === annotations.negative.file)
      assert.equal(after.crossEvents.length, 0);
    rows.push({ context, before, after });
  }
  results.push({ id, frames: data.rawFrames.length, rows });
}
console.log(
  JSON.stringify(
    {
      scope:
        "Command recognition in each fixed allowed state, not a full UI simulation. Same saved landmarks and 30 fps timestamps; core scoring and baseline files untouched.",
      results,
    },
    null,
    2,
  ),
);
