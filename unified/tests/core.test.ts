import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../packages/coach-core/src/analyze";
import { StreamCoach } from "../packages/coach-core/src/stream";
import { mapPoint } from "../apps/web/src/pose/overlay";
import { angle, roundEven } from "../packages/coach-core/src/math";
import { normalize, visible } from "../packages/coach-core/src/normalize";
import type {
  Frame,
  VideoInfo,
  Move,
  Stance,
  Report,
} from "../packages/coach-core/src/types";
type Case = {
  id: string;
  frames: Frame[];
  info: VideoInfo;
  move: Move;
  stance: Stance;
  report: Report;
};
const examples = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
) as Case[];
const clone = <T>(x: T): T => structuredClone(x);
function replay(c: Case, frames = c.frames) {
  const coach = new StreamCoach(c.move, c.stance),
    reports: Report[] = [];
  let max = 0;
  for (const f of frames) {
    const r = coach.push(f, c.info.width, c.info.height);
    max = Math.max(max, r.bufferSize);
    if (r.result) reports.push(r.result);
  }
  return { reports, max };
}
test("degenerate angle is unavailable, Python rounding preserved", () => {
  assert.equal(angle([0, 0], [0, 0], [1, 0]), null);
  assert.equal(roundEven(82.5), 82);
  assert.equal(roundEven(83.5), 84);
});
test("web SDK missing presence is explicit, never substituted with 100% confidence", () => {
  const p = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
  assert.equal(visible(p), false);
  assert.equal(visible({ ...p, presence_unavailable: true }), true);
  assert.equal(
    visible({ ...p, presence_unavailable: true, presence: 0 }),
    false,
  );
  assert.equal(
    visible({ ...p, presence_unavailable: true, visibility: 0.1 }),
    false,
  );
});
test("overlay contain and mirror use the identical video rectangle", () => {
  const p = { x: 0.25, y: 0.5, z: 0 };
  assert.deepEqual(mapPoint(p, 1280, 720, 960, 720, false), { x: 240, y: 360 });
  assert.deepEqual(mapPoint(p, 1280, 720, 960, 720, true), { x: 720, y: 360 });
  assert.deepEqual(mapPoint({ x: 0, y: 0, z: 0 }, 720, 1280, 960, 720, false), {
    x: 277.5,
    y: 0,
  });
});
for (const c of examples.filter(
  (c) => c.move !== "cross" && c.id.endsWith("_normal"),
))
  test(`live one attempt: ${c.id}`, () => {
    const { reports, max } = replay(c);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].status, "completed");
    assert.ok(max < 200);
  });
for (const move of ["jab", "hook"] as const) {
  const c = examples.find((c) => c.id === `${move}_orthodox_30_normal`)!;
  test(`two ${move}s counted exactly once each`, () => {
    const frames = [
      ...c.frames,
      ...c.frames.map((f) => ({
        ...f,
        frame: f.frame + c.frames.length,
        timestamp_ms: f.timestamp_ms + 2800,
      })),
    ];
    const { reports } = replay(c, frames);
    assert.equal(reports.length, 2);
    assert.ok(reports.every((r) => r.status === "completed"));
  });
  test(`stillness does not count ${move}`, () => {
    const still = examples.find(
      (c) => c.id === `${move}_orthodox_30_no_motion`,
    )!;
    assert.equal(replay(still).reports.length, 0);
  });
  test(`${move} lost wrist doesn't become bad technique`, () => {
    const frames = clone(c.frames);
    for (const f of frames)
      if (f.timestamp_ms >= 1000 && f.timestamp_ms <= 1500)
        f.landmarks.left_wrist.visibility = 0;
    const { reports } = replay(c, frames);
    assert.ok(reports.length >= 1);
    assert.ok(
      reports.every(
        (r) =>
          r.status === "unreliable" && r.score === null && !r.violations.length,
      ),
    );
  });
  test(`${move} multiple people abandon attempt`, () => {
    const frames = clone(c.frames);
    for (const f of frames)
      if (f.timestamp_ms >= 1000 && f.timestamp_ms <= 1500) f.pose_count = 2;
    assert.ok(
      replay(c, frames).reports.some(
        (r) => r.quality.issues[0].code === "multiple_people",
      ),
    );
  });
  test(`${move} no return finishes only after timeout`, () => {
    const n = examples.find((c) => c.id === `${move}_orthodox_30_no_return`)!;
    const coach = new StreamCoach(move, "orthodox");
    const end = n.frames.at(-1)!;
    const extended = [
      ...n.frames,
      ...Array.from({ length: 30 }, (_, i) => ({
        ...end,
        frame: end.frame + i + 1,
        timestamp_ms: end.timestamp_ms + (i + 1) * 33,
      })),
    ];
    let at = 0;
    const results: Report[] = [];
    for (const f of extended) {
      const u = coach.push(f, 640, 480);
      if (u.result) {
        results.push(u.result);
        at = f.timestamp_ms;
      }
    }
    assert.equal(results.length, 1);
    assert.ok(at >= 2500);
    assert.ok(
      results[0].violations.some((v) => v.code === "not_returned_to_guard"),
    );
  });
}
test("pause/reset clears pending movement", () => {
  const c = examples.find((c) => c.id === "jab_orthodox_30_normal")!,
    coach = new StreamCoach("jab", "orthodox");
  for (const f of c.frames.slice(0, 34)) coach.push(f, 640, 480);
  coach.reset();
  const still = examples.find((c) => c.id === "jab_orthodox_30_no_motion")!;
  for (const f of still.frames)
    assert.equal(coach.push(f, 640, 480).result, null);
});
test("long timestamp gap rejects active attempt", () => {
  const c = examples.find((c) => c.id === "jab_orthodox_30_normal")!;
  const frames = clone(c.frames).filter(
    (f) => f.timestamp_ms < 1050 || f.timestamp_ms > 1550,
  );
  assert.ok(replay(c, frames).reports.some((r) => r.status === "unreliable"));
});
test("no visible points never retained by smoothing", () => {
  const c = clone(examples[0]);
  for (const f of c.frames.slice(30, 35)) f.landmarks.left_wrist.visibility = 0;
  const n = normalize(c.frames, c.info);
  assert.ok(n.slice(30, 35).every((f) => !f.smooth_image.left_wrist));
});
test("nonmonotonic input rejected", () => {
  const c = clone(examples[0]);
  c.frames[5].timestamp_ms = c.frames[4].timestamp_ms;
  assert.throws(() => analyze(c.frames, c.info, c.move, c.stance));
});
test("five-minute idle stream stays bounded", () => {
  const c = examples.find((c) => c.id === "jab_orthodox_30_no_motion")!,
    coach = new StreamCoach("jab", "orthodox");
  for (let i = 0; i < 9000; i++) {
    const u = coach.push(
      { ...c.frames[0], frame: i, timestamp_ms: Math.round((i * 1000) / 30) },
      640,
      480,
    );
    assert.ok(u.bufferSize <= 24);
    assert.equal(u.result, null);
  }
});
