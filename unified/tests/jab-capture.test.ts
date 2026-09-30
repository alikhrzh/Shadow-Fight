import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AttemptController } from "../apps/web/src/training/attemptController";
import { normalize } from "../packages/coach-core/src/normalize";
import { safePayload } from "../apps/web/src/feedback/safePayload";
import {
  expectedHand,
  other,
  type Frame,
  type Report,
  type Stance,
} from "../packages/coach-core/src/types";
const cases = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
) as {
  id: string;
  stance: Stance;
  frames: Frame[];
}[];
const normal = cases.find((c) => c.id === "jab_orthodox_30_normal")!;
const copy = <T>(value: T): T => structuredClone(value);
function replay(
  frames: Frame[],
  stance: Stance = "orthodox",
  width = 640,
  height = 480,
) {
  const controller = new AttemptController("jab", stance);
  let mode: "calibrate" | "capture" = "calibrate",
    max = 0;
  const reports: Report[] = [],
    phases: { time: number; phase: string }[] = [];
  for (const f of frames) {
    const u = controller.push(f, width, height, mode, "one");
    if (u.phase === "ready") mode = "capture";
    if (u.result) reports.push(u.result);
    max = Math.max(max, u.bufferSize);
    phases.push({ time: f.timestamp_ms, phase: u.phase });
  }
  return { reports, phases, max, controller };
}
function preparedMotion(
  kind: "lower" | "raise" | "translate",
  start = 800,
  end = 1800,
) {
  return normal.frames.map((original) => {
    const f = copy(normal.frames[0]);
    f.frame = original.frame;
    f.timestamp_ms = original.timestamp_ms;
    const t = Math.max(0, Math.min(1, (f.timestamp_ms - start) / 400));
    const amount =
      f.timestamp_ms > end ? Math.max(0, 1 - (f.timestamp_ms - end) / 400) : t;
    if (kind === "translate") {
      for (const p of Object.values(f.landmarks)) {
        p.x += 0.12 * amount;
        p.y += 0.04 * amount;
      }
    } else
      for (const hand of ["left", "right"]) {
        f.landmarks[`${hand}_wrist`].y +=
          (kind === "lower" ? 0.48 : -0.2) * amount;
        f.landmarks[`${hand}_elbow`].y +=
          (kind === "lower" ? 0.15 : -0.32) * amount;
      }
    return f;
  });
}

for (const kind of ["lower", "raise", "translate"] as const)
  test(`jab gate: ${kind} after a valid guard is not a punch`, () => {
    const r = replay(preparedMotion(kind));
    assert.equal(r.reports.length, 0);
    assert.ok(!r.phases.some((p) => p.phase === "punch"));
  });

test("lowering then raising into guard can recover and capture a later jab with the same ID", () => {
  const prep = preparedMotion("lower");
  const punch = normal.frames.map((f) => ({
    ...f,
    timestamp_ms: f.timestamp_ms + 2800,
  }));
  const { reports } = replay([...prep, ...punch]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, "completed");
  assert.ok(reports[0].capture!.onset_ms > 3500);
});

test("a later larger movement of the other hand cannot grade a different punch", () => {
  const frames = copy(normal.frames);
  for (const f of frames) {
    if (f.timestamp_ms < 1100) continue;
    const amount = Math.min(1, (f.timestamp_ms - 1100) / 200);
    f.landmarks.right_wrist.x += (0.001 - f.landmarks.right_wrist.x) * amount;
  }
  const { reports } = replay(frames);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.active_hand, "left");
  assert.equal(reports[0].status, "unreliable");
  assert.equal(reports[0].quality.issues[0].code, "ambiguous_attempt");
  assert.equal(reports[0].score, null);
  assert.equal(reports[0].metrics, null);
});

test("occluded guard arm does not cut off the jab, but still prevents an unjustified score", () => {
  const frames = copy(normal.frames);
  for (const f of frames)
    if (f.timestamp_ms >= 1050 && f.timestamp_ms <= 1450) {
      f.landmarks.right_wrist.visibility = 0.1;
      f.landmarks.right_elbow.visibility = 0.1;
    }
  const before = JSON.stringify(frames),
    { reports } = replay(frames);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "returned");
  assert.ok(reports[0].capture!.end_ms >= 1600);
  assert.equal(reports[0].status, "unreliable");
  assert.equal(reports[0].score, null);
  assert.equal(
    JSON.stringify(frames),
    before,
    "never modify the model observations",
  );
});

test("active wrist loss ends one unreliable attempt, without interpreting recovery as another", () => {
  const frames = copy(normal.frames);
  for (const f of frames)
    if (f.timestamp_ms >= 1050 && f.timestamp_ms <= 1450)
      f.landmarks.left_wrist.visibility = 0;
  const { reports } = replay([
    ...frames,
    ...normal.frames.map((f) => ({
      ...f,
      timestamp_ms: f.timestamp_ms + 2800,
    })),
  ]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "tracking_lost");
  assert.equal(reports[0].score, null);
  assert.deepEqual(reports[0].quality.issues[0].related_joints, ["left_wrist"]);
});

test("one missing detection during a jab does not fabricate points or erase its boundaries", () => {
  const frames = copy(normal.frames);
  frames.find((f) => f.timestamp_ms === 1200)!.pose_count = 0;
  const { reports } = replay(frames);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "returned");
  assert.equal(frames.find((f) => f.timestamp_ms === 1200)!.pose_count, 0);
});

test("multiple people never become a scored jab", () => {
  const frames = copy(normal.frames);
  frames.find((f) => f.timestamp_ms === 1200)!.pose_count = 2;
  const { reports } = replay(frames);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "tracking_lost");
  assert.equal(reports[0].score, null);
  assert.equal(reports[0].quality.issues[0].code, "multiple_people");
});

test("projected shoulders may narrow for capture, not for grading", () => {
  const frames = copy(normal.frames);
  for (const f of frames)
    if (f.timestamp_ms >= 1050 && f.timestamp_ms <= 1450) {
      f.landmarks.left_shoulder.x = 0.48;
      f.landmarks.right_shoulder.x = 0.52;
    }
  const info = {
    width: 640,
    height: 480,
    fps: 30,
    frame_count: frames.length,
    duration_ms: 2600,
  };
  const at = frames.findIndex((f) => f.timestamp_ms === 1200);
  assert.deepEqual(normalize(frames, info)[at].image, {});
  assert.ok(
    normalize(frames, info, { allowImageForeshortening: true })[at].image
      .left_wrist,
  );
  const { reports } = replay(frames);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "returned");
  assert.equal(reports[0].status, "unreliable");
  assert.equal(reports[0].score, null);
});

for (const stance of ["orthodox", "southpaw"] as const)
  for (const fps of [24, 30, 60])
    test(`wrong-hand jab remains wrong-hand: ${stance}, ${fps} fps`, () => {
      const c = cases.find((c) => c.id === `jab_${stance}_${fps}_wrong_hand`)!;
      const { reports } = replay(c.frames, stance);
      assert.equal(reports.length, 1);
      assert.equal(
        reports[0].capture!.active_hand,
        other(expectedHand("jab", stance)),
      );
      assert.ok(reports[0].violations.some((v) => v.code === "wrong_hand"));
    });

test("mirroring changes neither anatomical hand nor the captured interval", () => {
  const mirrored = copy(normal.frames);
  for (const f of mirrored)
    for (const p of Object.values(f.landmarks)) p.x = 1 - p.x;
  const a = replay(normal.frames).reports[0],
    b = replay(mirrored).reports[0];
  assert.deepEqual(b.capture, a.capture);
});

test("a later hand drop cannot replace a captured jab peak", () => {
  const frames = copy(normal.frames);
  for (const f of frames)
    if (f.timestamp_ms >= 1900)
      for (const h of ["left", "right"]) f.landmarks[`${h}_wrist`].y = 0.9;
  const { reports } = replay(frames);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "returned");
  assert.ok(reports[0].capture!.peak_ms < 1600);
  assert.ok(reports[0].capture!.end_ms < 1900);
});

test("timestamps gaps and changed resolution reject only the current jab", () => {
  for (const resize of [false, true]) {
    const a = new AttemptController("jab", "orthodox");
    let ready = false;
    const reports: Report[] = [];
    for (const f of normal.frames) {
      if (!resize && f.timestamp_ms > 1100 && f.timestamp_ms < 1300) continue;
      const u = a.push(
        f,
        resize && f.timestamp_ms >= 1200 ? 800 : 640,
        480,
        ready ? "capture" : "calibrate",
        "one",
      );
      if (u.phase === "ready") ready = true;
      if (u.result) reports.push(u.result);
    }
    assert.equal(reports.length, 1);
    assert.equal(reports[0].capture!.termination, "tracking_lost");
    assert.equal(reports[0].score, null);
  }
});

test("local capture timing is excluded from the AI payload", () => {
  const report = replay(normal.frames).reports[0];
  assert.ok(report.capture);
  const payload = safePayload(report)!;
  assert.ok(payload);
  assert.ok(!JSON.stringify(payload).includes("onset_ms"));
  assert.ok(!JSON.stringify(payload).includes("capture"));
});

test("long idle capture is bounded and emits no result", () => {
  const frames = Array.from({ length: 9000 }, (_, i) => ({
    ...normal.frames[0],
    frame: i,
    timestamp_ms: (i * 1000) / 30,
  }));
  const { reports, max } = replay(frames);
  assert.equal(reports.length, 0);
  assert.ok(max <= 23);
});

test("observe cancels a partially captured jab; a fresh ID still needs guard calibration", () => {
  const a = new AttemptController("jab", "orthodox");
  let ready = false;
  for (const f of normal.frames.filter((f) => f.timestamp_ms <= 1100)) {
    const u = a.push(f, 640, 480, ready ? "capture" : "calibrate", "one");
    if (u.phase === "ready") ready = true;
  }
  a.push(normal.frames[36], 640, 480, "observe", null);
  for (const f of normal.frames.slice(37))
    assert.equal(a.push(f, 640, 480, "capture", "two").result, null);
});

// Separate earlier recordings expose gradual-return regressions that a clean
// synthetic hold does not. These private files are optional in a public checkout.
const privateFile = new URL(
  "../private-data/browser-replay.json",
  import.meta.url,
);
const privateCases: {
  id: string;
  rawFrames: Frame[];
  info: { width: number; height: number };
}[] = existsSync(privateFile)
  ? JSON.parse(readFileSync(privateFile, "utf8"))
  : [];
for (const id of [
  "jab_001",
  "jab_002",
  "jab_004",
  "jab_005",
  "jab_011",
  "jab_013",
  "jab_014",
  "jab_015",
]) {
  const c = privateCases.find((c) => c.id === id);
  test(
    `private guarded jab ${id}: finish within observed clip, no synthetic tail`,
    { skip: !c },
    () => {
      const { reports } = replay(
        c!.rawFrames,
        "orthodox",
        c!.info.width,
        c!.info.height,
      );
      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, "completed");
      assert.equal(reports[0].capture!.termination, "returned");
      assert.ok(
        reports[0].capture!.end_ms <= c!.rawFrames.at(-1)!.timestamp_ms,
      );
    },
  );
}
for (const id of [
  "no_punch_001__jab",
  "no_punch_002__jab",
  "no_punch_003__jab",
]) {
  const c = privateCases.find((c) => c.id === id);
  test(`private non-punch ${id}: no captured attempt`, { skip: !c }, () => {
    assert.equal(
      replay(c!.rawFrames, "orthodox", c!.info.width, c!.info.height).reports
        .length,
      0,
    );
  });
}

test("a missing active elbow below the time limit cannot advance a return hold", () => {
  const frames = copy(normal.frames);
  for (const f of frames)
    if (f.timestamp_ms >= 1633 && f.timestamp_ms <= 1700)
      f.landmarks.left_elbow.visibility = 0;
  const { reports } = replay(frames);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "returned");
  assert.ok(reports[0].capture!.end_ms >= 1800);
});

test("repeated/nonmonotonic frames and invalid dimensions do not change a later valid attempt", () => {
  const a = new AttemptController("jab", "orthodox");
  let mode: "calibrate" | "capture" = "calibrate";
  const reports: Report[] = [];
  for (const f of normal.frames) {
    assert.equal(a.push(f, NaN, 480, mode, "one").result, null);
    const u = a.push(f, 640, 480, mode, "one");
    if (u.phase === "ready") mode = "capture";
    if (u.result) reports.push(u.result);
    assert.equal(a.push(f, 640, 480, mode, "one").result, null);
    assert.equal(
      a.push({ ...f, timestamp_ms: f.timestamp_ms - 1 }, 640, 480, mode, "one")
        .result,
      null,
    );
  }
  assert.equal(reports.length, 1);
  assert.deepEqual(
    reports[0].capture,
    replay(normal.frames).reports[0].capture,
  );
});

test("losing tracking before onset requires a new guard, not a baseline with hands down", () => {
  const frames = preparedMotion("lower");
  for (const f of frames)
    if (f.timestamp_ms >= 733 && f.timestamp_ms <= 800)
      f.landmarks.left_wrist.visibility = 0;
  const { reports } = replay(frames);
  assert.equal(reports.length, 0);
});

test("coincident shoulders are still rejected in capture normalization", () => {
  const frames = copy(normal.frames);
  for (const f of frames)
    if (f.timestamp_ms === 1200)
      f.landmarks.right_shoulder = { ...f.landmarks.left_shoulder };
  const at = frames.findIndex((f) => f.timestamp_ms === 1200);
  assert.deepEqual(
    normalize(
      frames,
      {
        width: 640,
        height: 480,
        fps: 30,
        frame_count: frames.length,
        duration_ms: 2600,
      },
      { allowImageForeshortening: true },
    )[at].image,
    {},
  );
});

test("the active buffer cap rejects unreasonably dense input without retaining more than 512 frames", () => {
  const initial = normal.frames.filter((f) => f.timestamp_ms <= 1100);
  const held = Array.from({ length: 650 }, (_, i) => ({
    ...initial.at(-1)!,
    timestamp_ms: 1101 + i,
  }));
  const { reports, max } = replay([...initial, ...held]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].capture!.termination, "tracking_lost");
  assert.equal(reports[0].score, null);
  assert.ok(max <= 512);
});

for (const stance of ["orthodox", "southpaw"] as const)
  for (const [scale, dx, dy] of [
    [0.5, -0.05, 0.05],
    [0.8, 0.08, -0.04],
    [1, -0.04, 0.02],
    [1.25, 0, 0],
  ])
    test(`jab framing invariance: ${stance}, scale ${scale}`, () => {
      const c = cases.find((c) => c.id === `jab_${stance}_30_normal`)!;
      const frames = copy(c.frames);
      for (const f of frames)
        for (const p of Object.values(f.landmarks)) {
          p.x = 0.5 + (p.x - 0.5) * scale + dx;
          p.y = 0.5 + (p.y - 0.5) * scale + dy;
        }
      const before = replay(c.frames, stance).reports[0];
      const { reports } = replay(frames, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, "completed");
      assert.equal(
        reports[0].capture!.active_hand,
        before.capture!.active_hand,
      );
      assert.equal(reports[0].capture!.termination, "returned");
      for (const key of ["onset_ms", "peak_ms", "end_ms"] as const)
        assert.ok(
          Math.abs(reports[0].capture![key] - before.capture![key]) <= 34,
        );
    });

for (const stride of [2, 3])
  for (let offset = 0; offset < stride; offset++)
    test(`sparse synthetic jab: ${30 / stride} fps, phase ${offset}`, () => {
      const { reports } = replay(
        normal.frames.filter((_, i) => i % stride === offset),
      );
      assert.equal(reports.length, 1);
      assert.equal(reports[0].capture!.termination, "returned");
      assert.equal(reports[0].capture!.active_hand, "left");
    });

test("small deterministic landmark jitter in a guard is not a jab", () => {
  let seed = 42;
  const noise = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 0.002;
  };
  const frames = Array.from({ length: 900 }, (_, i) => {
    const f = copy(normal.frames[0]);
    f.frame = i;
    f.timestamp_ms = (i * 1000) / 30;
    for (const p of Object.values(f.landmarks)) {
      p.x += noise();
      p.y += noise();
    }
    return f;
  });
  assert.equal(replay(frames).reports.length, 0);
});

for (const first of ["left", "right"] as const)
  for (const delay of [0, 100, 200, 350])
    test(`both hands raised after guard: ${first} first, ${delay}ms delay, never a graded jab`, () => {
      const frames = Array.from({ length: 105 }, (_, i) => {
        const f = copy(normal.frames[0]);
        f.frame = i;
        f.timestamp_ms = (i * 1000) / 30;
        for (const hand of ["left", "right"]) {
          const amount = Math.max(
            0,
            Math.min(
              1,
              (f.timestamp_ms - 800 - (hand === first ? 0 : delay)) / 400,
            ),
          );
          f.landmarks[`${hand}_wrist`].y -= 0.2 * amount;
          f.landmarks[`${hand}_elbow`].y -= 0.32 * amount;
        }
        return f;
      });
      const { reports } = replay(frames);
      assert.ok(reports.length <= 1);
      for (const r of reports) {
        assert.equal(r.status, "no_attempt");
        assert.equal(r.score, null);
        assert.equal(r.capture, undefined);
        assert.equal(safePayload(r), null);
      }
      if (delay >= 200)
        assert.equal(
          reports.length,
          1,
          "cancel the initially ambiguous single-hand candidate",
        );
    });
