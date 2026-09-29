import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { analyze } from "../packages/coach-core/src/analyze";
import { StreamCoach } from "../packages/coach-core/src/stream";
import type { Frame, Move, VideoInfo } from "../packages/coach-core/src/types";
const file = new URL("../private-data/browser-replay.json", import.meta.url);
const selected = new Set([
  "jab_001",
  "jab_007",
  "hook_001",
  "hook_002",
  "hook_006",
  "no_punch_001__jab",
  "no_punch_002__jab",
  "no_punch_003__jab",
]);
const cases: { id: string; move: Move; info: VideoInfo; rawFrames: Frame[] }[] =
  existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8")).filter((c: { id: string }) =>
        selected.has(c.id),
      )
    : [];
test(
  "private browser replay is available only in local validation",
  { skip: !cases.length },
  () => assert.equal(cases.length, 8),
);
for (const c of cases) {
  test(`fresh browser model ${c.id}`, () => {
    const r = analyze(c.rawFrames, c.info, c.move, "orthodox");
    assert.equal(
      r.status,
      c.id.startsWith("no_punch") ? "no_attempt" : "completed",
    );
    assert.equal(r.confidence_mode, "visibility_only_web");
  });
  if (c.move === "hook")
    test(`stream ${c.id}: truncated clip is not prematurely graded; timeout works with synthetic stationary tail`, () => {
      const coach = new StreamCoach("hook", "orthodox"),
        results = [];
      for (const f of c.rawFrames) {
        const u = coach.push(f, c.info.width, c.info.height);
        if (u.result) results.push(u.result);
      }
      assert.equal(results.length, 0);
      // This is an explicit synthetic hold of the last measured pose, NOT new video evidence.
      const last = c.rawFrames.at(-1)!;
      for (let i = 1; i <= 60; i++) {
        const u = coach.push(
          {
            ...last,
            frame: last.frame + i,
            timestamp_ms: last.timestamp_ms + i * 33,
          },
          c.info.width,
          c.info.height,
        );
        if (u.result) results.push(u.result);
      }
      assert.equal(results.length, 1);
      assert.equal(results[0].status, "completed");
    });
}
