import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { body, guardVisible } from "../apps/web/src/gestures/geometry";
import { detectHandsUp } from "../apps/web/src/gestures/detectHandsUp";
import { detectCrossedArms } from "../apps/web/src/gestures/detectCrossedArms";
import { emptyHold, gestureHold } from "../apps/web/src/gestures/gestureHold";
import {
  initialTraining,
  trainingReducer as reduce,
  exitGestureAllowed,
  cameraActive,
  type Training,
} from "../apps/web/src/training/trainingMachine";
import { AttemptController } from "../apps/web/src/training/attemptController";
import { cameraQuality } from "../apps/web/src/training/cameraQuality";
import {
  addProgress,
  readProgress,
  saveProgress,
} from "../apps/web/src/progress/progressStore";
import {
  expectedHand,
  type Frame,
  type Report,
  type Move,
  type Stance,
} from "../packages/coach-core/src/types";
const cases = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
) as {
  id: string;
  frames: Frame[];
  move: Move;
  stance: Stance;
  report: Report;
}[];
const sample = cases.find((c) => c.id === "jab_orthodox_30_normal")!;
function pose(kind: "up" | "cross" | "guard") {
  const f = structuredClone(sample.frames[0]),
    p = f.landmarks;
  if (kind === "up")
    for (const side of ["left", "right"]) {
      p[`${side}_wrist`].y = 0.06;
      p[`${side}_elbow`].y = 0.23;
    }
  if (kind === "cross") {
    p.left_wrist.x = 0.59;
    p.right_wrist.x = 0.41;
    p.left_wrist.y = p.right_wrist.y = 0.4;
  }
  return f;
}
const normalized = (f: Frame) => body(f, 640, 480);
test("crossed arms cannot be calibrated as a boxing guard", () => {
  const a = new AttemptController("jab", "orthodox");
  assert.equal(guardVisible(normalized(pose("cross"))), false);
  for (let t = 0; t < 2000; t += 33) {
    const u = a.push(
      { ...pose("cross"), timestamp_ms: t },
      640,
      480,
      "calibrate",
      "one",
    );
    assert.notEqual(u.phase, "ready");
    assert.equal(u.result, null);
  }
});
test("cooldown blocks early reacquisition even after release", () => {
  let s = emptyHold();
  for (let t = 0; t <= 1000; t += 50) s = gestureHold(s, true, t, 950).state;
  for (let t = 1050; t <= 1350; t += 50)
    s = gestureHold(s, false, t, 950).state;
  assert.equal(s.latched, false);
  for (let t = 1400; t <= 2500; t += 50) {
    const r = gestureHold(s, true, t, 950);
    s = r.state;
    assert.equal(r.fired, false);
    assert.equal(r.progress, 0);
  }
});
test("camera failure during AI retains local score and ends the spinner", () => {
  let s = reduce(capturing(), {
    type: "REPORT",
    attemptId: "one",
    report: sample.report,
  });
  s = reduce(s, { type: "ANALYZE", attemptId: "one" });
  s = reduce(s, { type: "ERROR", message: "Камера отключена" });
  assert.equal(s.state, "camera_error");
  assert.equal(s.ai, "fallback");
  assert.equal(s.report!.score, sample.report.score);
  assert.equal(cameraActive(s.state), false);
});
test("hold excludes unobserved time and resets when recovery follows a long missed interval", () => {
  let state = emptyHold();
  for (let t = 0; t <= 500; t += 50)
    state = gestureHold(state, true, t, 950).state;
  state = gestureHold(state, false, 550, 950).state;
  state = gestureHold(state, false, 650, 950).state;
  state = gestureHold(state, true, 750, 950).state;
  assert.equal(state.held, 0);
  state = gestureHold(state, true, 1000, 950).state;
  assert.equal(state.held, 0);
});
test("hands up: both wrists above head; guard and face rejected", () => {
  assert.ok(detectHandsUp(normalized(pose("up"))));
  assert.ok(!detectHandsUp(normalized(pose("guard"))));
  const f = pose("up");
  f.landmarks.left_wrist.y = 0.24;
  assert.ok(!detectHandsUp(normalized(f)));
});
test("hands up requires visible wrists, elbows and shoulders", () => {
  for (const k of [
    "left_wrist",
    "right_wrist",
    "left_elbow",
    "right_shoulder",
  ]) {
    const f = pose("up");
    f.landmarks[k].visibility = 0.1;
    assert.ok(!detectHandsUp(normalized(f)));
  }
});
test("hysteresis keeps near-threshold raised hands but does not enter early", () => {
  const p = normalized(pose("up"));
  p.left_wrist[1] = p.nose[1] - 0.38;
  assert.equal(detectHandsUp(p), false);
  assert.equal(detectHandsUp(p, true), true);
});
test("cross requires opposite shoulder proximity and intersecting forearms", () => {
  assert.ok(detectCrossedArms(normalized(pose("cross"))));
  assert.ok(!detectCrossedArms(normalized(pose("guard"))));
  const f = pose("cross");
  f.landmarks.left_wrist.x = 0.38;
  f.landmarks.right_wrist.x = 0.62;
  assert.ok(!detectCrossedArms(normalized(f)));
  f.landmarks.left_wrist.visibility = 0;
  assert.ok(!detectCrossedArms(normalized(f)));
});
test("cross rejects missing wrist, multiple people and hands near own shoulders", () => {
  const f = pose("cross");
  f.landmarks.right_wrist.visibility = 0;
  assert.ok(!detectCrossedArms(normalized(f)));
  f.landmarks.right_wrist.visibility = 1;
  f.pose_count = 2;
  assert.ok(!detectCrossedArms(normalized(f)));
});
for (const kind of ["up", "cross"] as const) {
  test(`${kind}: mirroring and proportional scale keep recognition`, () => {
    const f = pose(kind),
      detect = kind === "up" ? detectHandsUp : detectCrossedArms;
    for (const p of Object.values(f.landmarks)) p.x = 1 - p.x;
    assert.ok(detect(normalized(f)));
    for (const p of Object.values(f.landmarks)) {
      p.x = 0.25 + p.x * 0.5;
      p.y = 0.2 + p.y * 0.5;
    }
    assert.ok(detect(normalized(f)));
  });
  const duration = kind === "up" ? 950 : 1350;
  test(`${kind}: hold progress, short dropped frame, one event, cooldown and release`, () => {
    let state = emptyHold(),
      fires = 0,
      progress = 0;
    for (let now = 0; now <= 3000; now += 50) {
      const r = gestureHold(state, now !== 400, now, duration);
      state = r.state;
      progress = r.progress;
      if (now === 500) assert.ok(progress > 0 && progress < 1);
      fires += Number(r.fired);
      if (now < duration) assert.equal(r.fired, false);
    }
    assert.equal(fires, 1);
    assert.equal(progress, 1);
    for (let now = 3050; now <= 3400; now += 50)
      state = gestureHold(state, false, now, duration).state;
    assert.equal(state.held, 0);
    assert.equal(state.latched, false);
    for (let now = 3450; now <= 5200; now += 50) {
      const r = gestureHold(state, true, now, duration);
      state = r.state;
      fires += Number(r.fired);
    }
    assert.equal(fires, 2);
  });
  test(`${kind}: lost tracking resets incomplete hold and nonmonotonic frames cannot progress`, () => {
    let state = emptyHold();
    for (let now = 0; now <= 500; now += 50)
      state = gestureHold(state, true, now, duration).state;
    const old = state;
    assert.equal(gestureHold(state, true, 400, duration).state, old);
    state = gestureHold(state, true, 1000, duration).state;
    assert.ok(state.held < duration);
    for (let now = 1050; now <= 1300; now += 50)
      state = gestureHold(state, false, now, duration).state;
    assert.equal(state.held, 0);
  });
}
function capturing(id = "one"): Training {
  let s = reduce(initialTraining, { type: "SELECT", move: "jab" });
  s = reduce(s, { type: "PRACTICE" });
  s = reduce(s, { type: "CAMERA_READY" });
  s = reduce(s, { type: "POSITION", good: true });
  s = reduce(s, { type: "START", attemptId: id });
  s = reduce(s, { type: "COUNTDOWN_DONE", attemptId: id });
  s = reduce(s, { type: "GUARD_READY", attemptId: id });
  return s;
}
test("state machine: complete path, exactly one result, retry uses new ID, stale worker and AI ignored", () => {
  let s = capturing();
  assert.equal(s.state, "capturing_attempt");
  s = reduce(s, { type: "REPORT", attemptId: "one", report: sample.report });
  assert.equal(s.state, "local_analysis");
  assert.equal(
    reduce(s, { type: "REPORT", attemptId: "one", report: sample.report }),
    s,
  );
  s = reduce(s, { type: "ANALYZE", attemptId: "one" });
  assert.equal(s.state, "ai_analysis");
  s = reduce(s, { type: "AI_DONE", attemptId: "one", feedback: null });
  assert.equal(s.state, "result");
  assert.equal(reduce(s, { type: "START", attemptId: "one" }), s);
  s = reduce(s, { type: "START", attemptId: "two" });
  assert.equal(s.state, "countdown");
  assert.equal(reduce(s, { type: "START", attemptId: "three" }), s);
  assert.equal(
    reduce(s, { type: "AI_DONE", attemptId: "one", feedback: null }),
    s,
  );
  assert.equal(
    reduce(s, { type: "REPORT", attemptId: "one", report: sample.report }),
    s,
  );
});
test("mandatory stages cannot be skipped; exit and hidden revoke camera and attempt", () => {
  assert.equal(reduce(initialTraining, { type: "PRACTICE" }), initialTraining);
  assert.equal(
    reduce(initialTraining, { type: "START", attemptId: "x" }),
    initialTraining,
  );
  let s = capturing();
  for (const state of [
    "countdown",
    "calibrating_guard",
    "capturing_attempt",
    "local_analysis",
    "ai_analysis",
  ] as const)
    assert.equal(exitGestureAllowed(state), false);
  for (const type of ["EXIT", "HIDDEN"] as const) {
    s = reduce(s, { type });
    assert.equal(cameraActive(s.state), false);
    assert.equal(s.attemptId, null);
    assert.equal(
      reduce(s, { type: "REPORT", attemptId: "one", report: sample.report }),
      s,
    );
  }
});
test("unreliable results skip AI and do not increase progress", () => {
  const report: Report = {
    ...sample.report,
    status: "unreliable",
    score: null,
  };
  const s = reduce(
    reduce(capturing(), { type: "REPORT", attemptId: "one", report }),
    { type: "ANALYZE", attemptId: "one" },
  );
  assert.equal(s.state, "result");
  assert.equal(s.ai, "skipped");
  assert.deepEqual(addProgress({}, report), {});
});
for (const c of cases.filter((c) => c.id.endsWith("_normal")))
  test(`controlled attempt ${c.id}: observe is not scored, guard then exactly one result`, () => {
    const a = new AttemptController(c.move, c.stance);
    for (const f of c.frames)
      assert.equal(a.push(f, 640, 480, "observe", null).result, null);
    let ready = false,
      count = 0;
    for (const f of c.frames) {
      const u = a.push(f, 640, 480, ready ? "capture" : "calibrate", "a");
      if (u.phase === "ready") ready = true;
      if (u.result) {
        count++;
        assert.equal(u.result.status, "completed");
        assert.equal(
          u.result.metrics?.expected_hand,
          expectedHand(c.move, c.stance),
        );
      }
    }
    for (const f of c.frames)
      assert.equal(
        a.push(
          { ...f, timestamp_ms: f.timestamp_ms + 3000 },
          640,
          480,
          "capture",
          "a",
        ).result,
        null,
      );
    assert.equal(count, 1);
  });
test("raised/lowered arms never calibrate or become an attempt; capture without calibration is ignored", () => {
  const a = new AttemptController("jab", "orthodox");
  assert.equal(guardVisible(normalized(pose("up"))), false);
  for (let t = 0; t <= 2000; t += 33) {
    const u = a.push(
      { ...pose("up"), timestamp_ms: t },
      640,
      480,
      "calibrate",
      "one",
    );
    assert.notEqual(u.phase, "ready");
    assert.equal(u.result, null);
  }
  a.reset();
  for (const f of sample.frames)
    assert.equal(a.push(f, 640, 480, "capture", "two").result, null);
});
test("camera setup messages distinguish lighting, people, wrist and slow processing", () => {
  assert.match(cameraQuality(pose("guard"), 30, true)!, /Освещение/);
  assert.match(
    cameraQuality({ ...pose("guard"), pose_count: 2 }, 30, false)!,
    /один человек/,
  );
  const f = pose("guard");
  f.landmarks.left_wrist.visibility = 0;
  assert.match(cameraQuality(f, 30, false)!, /обе кисти/);
  assert.match(cameraQuality(pose("guard"), 5, false)!, /медленная/);
  assert.equal(cameraQuality(pose("guard"), 30, false), null);
});
test("progress retains only aggregates and survives unavailable storage", () => {
  const p = addProgress(addProgress({}, sample.report), {
    ...sample.report,
    score: 80,
  });
  assert.equal(p.jab!.count, 2);
  assert.equal(p.jab!.average, 90);
  assert.equal(p.jab!.best, 100);
  assert.equal(JSON.stringify(p).includes("landmarks"), false);
  assert.deepEqual(readProgress(), {});
  assert.equal(saveProgress(p), false);
});
