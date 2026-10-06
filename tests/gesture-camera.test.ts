import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cameraQuality,
  gestureCameraQuality,
} from "../apps/web/src/training/cameraQuality";
import { body } from "../apps/web/src/gestures/geometry";
import { detectHandsUp } from "../apps/web/src/gestures/detectHandsUp";
import { emptyHold, gestureHold } from "../apps/web/src/gestures/gestureHold";
import {
  initialTraining,
  startAllowed,
  trainingReducer,
  exitGestureAllowed,
} from "../apps/web/src/training/trainingMachine";
import type { Frame } from "../packages/coach-core/src/types";

const sample = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
).find((c: { id: string }) => c.id === "jab_orthodox_30_normal");
function raised(scale = 1): Frame {
  const f: Frame = structuredClone(sample.frames[0]);
  for (const side of ["left", "right"]) {
    f.landmarks[`${side}_wrist`].y = 0.06;
    f.landmarks[`${side}_elbow`].y = 0.23;
  }
  for (const p of Object.values(f.landmarks)) {
    p.x = 0.5 + (p.x - 0.5) * scale;
    p.y = 0.5 + (p.y - 0.5) * scale;
  }
  return f;
}
const quality = (f: Frame, fps = 30, dark = false) =>
  gestureCameraQuality(f, fps, dark, 640, 480);

test("visible small raised arms can start without weakening punch framing", () => {
  const f = raised(0.4);
  assert.match(cameraQuality(f, 30, false)!, /ближе/);
  assert.equal(quality(f), null);
  assert.equal(detectHandsUp(body(f, 640, 480)), true);
  let s = emptyHold(),
    fires = 0;
  for (let t = 0; t < 3000; t += 50) {
    const r = gestureHold(
      s,
      !quality(f) && detectHandsUp(body(f, 640, 480)),
      t,
      950,
    );
    s = r.state;
    fires += Number(r.fired);
  }
  assert.equal(fires, 1);
  assert.match(cameraQuality(f, 30, false)!, /ближе/);
});

test("gesture quality still rejects dark, slow, absent or ambiguous person", () => {
  assert.match(quality(raised(), 30, true)!, /Освещение/);
  assert.match(quality(raised(), 5)!, /медленная/);
  assert.match(quality({ ...raised(), pose_count: 0 })!, /не найден/);
  assert.match(quality({ ...raised(), pose_count: 2 })!, /один человек/);
});

test("gesture quality requires every command joint, confidence and frame bounds", () => {
  for (const name of [
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
  ]) {
    for (const patch of [
      { visibility: 0.1 },
      { presence: 0.1 },
      { y: -0.01 },
      { x: NaN },
    ]) {
      const f = raised();
      Object.assign(f.landmarks[name], patch);
      assert.notEqual(quality(f), null, name + JSON.stringify(patch));
    }
    const f = raised();
    delete f.landmarks[name];
    assert.notEqual(quality(f), null);
  }
});

test("gesture quality ignores cropped feet, but rejects unusable shoulder scale and image size", () => {
  const f = raised();
  f.landmarks.left_ankle = { ...f.landmarks.left_wrist, x: -0.1 };
  assert.equal(quality(f), null);
  assert.match(cameraQuality(f, 30, false)!, /Отойдите/);
  assert.match(quality(raised(0.01))!, /плечи плохо различимы/);
  for (const size of [0, -1, NaN, Infinity]) {
    assert.notEqual(gestureCameraQuality(raised(), 30, false, size, 480), null);
    assert.notEqual(gestureCameraQuality(raised(), 30, false, 640, size), null);
  }
});

test("one raised hand or guard never starts even with valid gesture framing", () => {
  const f = raised(0.4);
  f.landmarks.left_wrist.y = f.landmarks.nose.y;
  assert.equal(quality(f), null);
  assert.equal(detectHandsUp(body(f, 640, 480)), false);
  assert.equal(detectHandsUp(body(sample.frames[0], 640, 480)), false);
});

test("AI pending permits a new attempt and ignores late old results without allowing exit gesture", () => {
  const pending = {
    ...initialTraining,
    state: "ai_analysis" as const,
    attemptId: "old",
    report: sample.report,
    ai: "loading" as const,
  };
  assert.equal(startAllowed(pending.state), true);
  assert.equal(exitGestureAllowed(pending.state), false);
  const next = trainingReducer(pending, { type: "START", attemptId: "new" });
  assert.equal(next.state, "countdown");
  assert.equal(next.report, null);
  assert.equal(next.ai, "idle");
  assert.equal(
    trainingReducer(next, {
      type: "AI_DONE",
      attemptId: "old",
      feedback: null,
    }),
    next,
  );
  assert.equal(
    trainingReducer(next, {
      type: "REPORT",
      attemptId: "old",
      report: sample.report,
    }),
    next,
  );
  for (const state of [
    "countdown",
    "calibrating_guard",
    "capturing_attempt",
    "local_analysis",
  ] as const)
    assert.equal(startAllowed(state), false);
});
