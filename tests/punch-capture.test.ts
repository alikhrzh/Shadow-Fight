import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AttemptController } from "../apps/web/src/training/attemptController";
import { safePayload } from "../apps/web/src/feedback/safePayload";
import {
  expectedHand,
  other,
  type Frame,
  type Move,
  type Stance,
  type Report,
} from "../packages/coach-core/src/types";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
) as { id: string; frames: Frame[] }[];
function sample(move: Move, stance: Stance = "orthodox", fps = 30) {
  return structuredClone(
    fixtures.find((f) => f.id === `${move}_${stance}_${fps}_normal`)!.frames,
  );
}
function replay(
  frames: Frame[],
  move: Move,
  stance: Stance = "orthodox",
  rearm = false,
  width = 640,
  height = 480,
) {
  const c = new AttemptController(move, stance),
    reports: Report[] = [];
  let mode: "calibrate" | "capture" = "calibrate",
    id = 1,
    maxBuffer = 0;
  for (const frame of frames) {
    const u = c.push(frame, width, height, mode, String(id));
    if (u.phase === "ready") mode = "capture";
    maxBuffer = Math.max(maxBuffer, u.bufferSize);
    if (u.result) {
      reports.push(u.result);
      if (rearm) {
        mode = "calibrate";
        id++;
      }
    }
  }
  return { reports, maxBuffer };
}
function prep(
  move: Move,
  stance: Stance,
  kind: "lower" | "raise" | "translate",
  delay = 0,
) {
  const frames = sample(move, stance),
    base = frames[0];
  return frames.map((original) => {
    const f = structuredClone(base);
    f.timestamp_ms = original.timestamp_ms;
    f.frame = original.frame;
    for (const h of ["left", "right"]) {
      const a = Math.max(
        0,
        Math.min(1, (f.timestamp_ms - 800 - (h === "right" ? delay : 0)) / 400),
      );
      if (kind !== "translate") {
        f.landmarks[`${h}_wrist`].y += (kind === "lower" ? 0.48 : -0.2) * a;
        f.landmarks[`${h}_elbow`].y += (kind === "lower" ? 0.15 : -0.32) * a;
      }
    }
    if (kind === "translate")
      for (const p of Object.values(f.landmarks)) {
        const a = Math.max(0, Math.min(1, (f.timestamp_ms - 800) / 400));
        p.x += 0.12 * a;
        p.y += 0.04 * a;
      }
    return f;
  });
}
for (const move of ["cross", "hook"] as const)
  for (const stance of ["orthodox", "southpaw"] as const) {
    const active = expectedHand(move, stance),
      guard = other(active);
    for (const kind of ["lower", "raise", "translate"] as const)
      test(`${move} ${stance}: ${kind} after guard is not a scored punch`, () => {
        const { reports } = replay(prep(move, stance, kind), move, stance);
        assert.equal(reports.length, 0);
      });
    test(`${move} ${stance}: asynchronous raised arms are never graded`, () => {
      for (const delay of [100, 200, 350])
        for (const r of replay(prep(move, stance, "raise", delay), move, stance)
          .reports) {
          assert.equal(r.status, "no_attempt");
          assert.equal(r.score, null);
          assert.equal(safePayload(r), null);
        }
    });
    for (const fps of [24, 30, 60])
      test(`${move} ${stance}: normal at ${fps} FPS has one complete capture`, () => {
        const { reports } = replay(sample(move, stance, fps), move, stance);
        assert.equal(reports.length, 1);
        const r = reports[0];
        assert.equal(r.status, "completed");
        assert.equal(r.capture!.active_hand, active);
        assert.equal(r.capture!.termination, "returned");
        assert.equal(r.expected_move, move);
        if (move === "hook") assert.equal(r.peak_method, "hook_medial_sweep");
      });
    test(`${move} ${stance}: guard occlusion preserves boundaries, not a fabricated score`, () => {
      const frames = sample(move, stance);
      for (const f of frames)
        if (f.timestamp_ms >= 1050 && f.timestamp_ms <= 1450) {
          f.landmarks[`${guard}_wrist`].visibility = 0.1;
          f.landmarks[`${guard}_elbow`].visibility = 0.1;
        }
      const frozen = JSON.stringify(frames),
        { reports } = replay(frames, move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].capture!.termination, "returned");
      assert.equal(reports[0].status, "unreliable");
      assert.equal(reports[0].score, null);
      assert.equal(safePayload(reports[0]), null);
      assert.equal(JSON.stringify(frames), frozen);
    });
    test(`${move} ${stance}: missing moving wrist safely rejects the attempt`, () => {
      const frames = sample(move, stance);
      for (const f of frames)
        if (f.timestamp_ms >= 1100)
          f.landmarks[`${active}_wrist`].visibility = 0.1;
      const { reports } = replay(frames, move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, "unreliable");
      assert.equal(reports[0].capture!.termination, "tracking_lost");
    });
    test(`${move} ${stance}: multiple people interrupt without a score`, () => {
      const frames = sample(move, stance);
      for (const f of frames) if (f.timestamp_ms >= 1100) f.pose_count = 2;
      const { reports } = replay(frames, move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].score, null);
      assert.equal(reports[0].quality.issues[0].code, "multiple_people");
    });
    test(`${move} ${stance}: one absent pose frame does not lose the attempt`, () => {
      const frames = sample(move, stance);
      const i = frames.findIndex((f) => f.timestamp_ms >= 1100);
      frames[i].pose_count = 0;
      frames[i].landmarks = {};
      const { reports } = replay(frames, move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].capture!.termination, "returned");
    });
    test(`${move} ${stance}: a short pose gap after guard does not cancel the next punch`, () => {
      const frames = sample(move, stance);
      for (const f of frames)
        if (f.timestamp_ms >= 700 && f.timestamp_ms <= 733) {
          f.pose_count = 0;
          f.landmarks = {};
        }
      const { reports } = replay(frames, move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].capture!.termination, "returned");
      assert.equal(reports[0].capture!.active_hand, active);
    });
    test(`${move} ${stance}: a long pose gap after guard requires recalibration`, () => {
      const frames = sample(move, stance);
      for (const f of frames)
        if (f.timestamp_ms >= 650 && f.timestamp_ms <= 1000) {
          f.pose_count = 0;
          f.landmarks = {};
        }
      assert.equal(replay(frames, move, stance).reports.length, 0);
    });
    test(`${move} ${stance}: wrong hand still receives wrong-hand feedback`, () => {
      const wrong = stance === "orthodox" ? "southpaw" : "orthodox";
      const { reports } = replay(sample(move, wrong), move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, "completed");
      assert.ok(reports[0].violations.some((v) => v.code === "wrong_hand"));
    });
    test(`${move} ${stance}: mirroring does not swap anatomical hand`, () => {
      const frames = sample(move, stance);
      for (const f of frames)
        for (const p of Object.values(f.landmarks)) p.x = 1 - p.x;
      const { reports } = replay(frames, move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].capture!.active_hand, active);
      assert.equal(reports[0].status, "completed");
    });
    test(`${move} ${stance}: preparation can recover for a punch on the same ID`, () => {
      const frames = [
        ...prep(move, stance, "lower"),
        ...sample(move, stance).map((f) => ({
          ...f,
          timestamp_ms: f.timestamp_ms + 3000,
        })),
      ];
      const { reports } = replay(frames, move, stance);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].status, "completed");
      assert.ok(reports[0].capture!.onset_ms > 3500);
    });
    test(`${move} ${stance}: repeated punches require separate attempts`, () => {
      const frames = [
        ...sample(move, stance),
        ...sample(move, stance).map((f) => ({
          ...f,
          timestamp_ms: f.timestamp_ms + 3000,
        })),
      ];
      assert.equal(replay(frames, move, stance).reports.length, 1);
      assert.equal(replay(frames, move, stance, true).reports.length, 2);
    });
  }
for (const stance of ["orthodox", "southpaw"] as const)
  test(`hook ${stance}: wind-up without inward sweep is not a punch`, () => {
    const frames = sample("hook", stance),
      base = frames[0],
      h = expectedHand("hook", stance);
    const direction =
      base.landmarks[`${h}_shoulder`].x <
      base.landmarks[`${other(h)}_shoulder`].x
        ? -1
        : 1;
    const windup = frames.map((original) => {
      const f = structuredClone(base);
      f.frame = original.frame;
      f.timestamp_ms = original.timestamp_ms;
      const a = Math.max(0, Math.min(1, (f.timestamp_ms - 800) / 400));
      f.landmarks[`${h}_wrist`].x += direction * 0.25 * a;
      f.landmarks[`${h}_wrist`].y -= 0.06 * a;
      f.landmarks[`${h}_elbow`].y -= 0.1 * a;
      return f;
    });
    assert.equal(replay(windup, "hook", stance).reports.length, 0);
  });
const dataRoot = new URL(
  "../private-data/testingdataset-2026-09-30/",
  import.meta.url,
);
for (const move of ["cross", "hook"] as const)
  for (const stance of ["orthodox", "southpaw"] as const)
    for (const [variant, code] of [
      ["dropped", "guard_dropped"],
      ["wrong_hand", "wrong_hand"],
      ["no_return", "not_returned_to_guard"],
    ])
      test(`${move} ${stance}: capture preserves ${code} feedback`, () => {
        const frames = structuredClone(
          fixtures.find((f) => f.id === `${move}_${stance}_30_${variant}`)!
            .frames,
        );
        if (variant === "no_return") {
          // Artificial stationary tail of a synthetic fixture, not video data:
          // give the capture watchdog time to finish a deliberately held punch.
          const last = frames.at(-1)!;
          for (let i = 1; i <= 30; i++)
            frames.push({
              ...structuredClone(last),
              frame: last.frame + i,
              timestamp_ms: last.timestamp_ms + (i * 1000) / 30,
            });
        }
        const { reports } = replay(frames, move, stance);
        assert.equal(reports.length, 1);
        assert.equal(reports[0].status, "completed");
        assert.ok(reports[0].violations.some((v) => v.code === code));
      });

for (const [id, move, found] of [
  ["kross10times", "cross", 11],
  ["hook10times", "hook", 13],
] as const)
  test(
    `private ${move}: retain real attempts and never score preparation instead`,
    { skip: !existsSync(new URL(`${id}.frames.json`, dataRoot)) },
    () => {
      const d = JSON.parse(
        readFileSync(new URL(`${id}.frames.json`, dataRoot), "utf8"),
      );
      const ann = JSON.parse(
        readFileSync(new URL("annotations.json", dataRoot), "utf8"),
      );
      let matched = 0;
      for (const [start, , end] of ann.punches[id].attempts) {
        const { reports } = replay(
          d.rawFrames.filter(
            (f: Frame) =>
              f.timestamp_ms >= (start - 3) * 1000 &&
              f.timestamp_ms <= (end + 2) * 1000,
          ),
          move,
          "orthodox",
          false,
          d.info.width,
          d.info.height,
        );
        assert.ok(reports.length <= 1);
        if (!reports.length) continue;
        const capture = reports[0].capture!;
        assert.ok(
          capture.peak_ms >= (start - 0.2) * 1000 &&
            capture.peak_ms <= (end + 0.2) * 1000,
        );
        assert.equal(capture.active_hand, expectedHand(move, "orthodox"));
        matched++;
      }
      assert.equal(
        matched,
        found,
        "Development-data regression count, not independent accuracy",
      );
    },
  );
for (const move of ["cross", "hook"] as const)
  for (const id of ["handup", "handcross", "freemotions"])
    test(
      `private ${move}: ${id} has no false attempts`,
      { skip: !existsSync(new URL(`${id}.frames.json`, dataRoot)) },
      () => {
        const d = JSON.parse(
          readFileSync(new URL(`${id}.frames.json`, dataRoot), "utf8"),
        );
        const { reports, maxBuffer } = replay(
          d.rawFrames,
          move,
          "orthodox",
          true,
          d.info.width,
          d.info.height,
        );
        assert.equal(reports.length, 0);
        assert.ok(maxBuffer <= 512);
      },
    );
