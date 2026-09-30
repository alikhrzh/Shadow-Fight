import test from "node:test";
import assert from "node:assert/strict";
import {
  qualitySummary,
  captureSummary,
} from "../apps/web/src/feedback/qualitySummary";
import { issue } from "../packages/coach-core/src/analyze";
import { emptyPhases, type Report } from "../packages/coach-core/src/types";
const report: Report = {
  expected_move: "jab",
  stance: "orthodox",
  status: "unreliable",
  score: null,
  phases: emptyPhases(),
  peak_method: null,
  main_feedback: "",
  violations: [],
  quality: { issues: [] },
  metrics: null,
  score_components: {},
  effective_weights: {},
};
test("repeated quality failures merge, preserving all known anatomical joints", () => {
  const r = {
    ...report,
    quality: {
      issues: [
        issue("low_pose_quality", ["right_elbow"]),
        issue("low_pose_quality", ["right_elbow", "left_shoulder"]),
        issue("wrist_not_visible", ["right_wrist"]),
      ],
    },
  };
  const before = JSON.stringify(r),
    messages = qualitySummary(r);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /правый локоть, левое плечо/);
  assert.match(messages[1], /правая кисть/);
  assert.equal(JSON.stringify(r), before);
});
test("a lost boundary is never presented as a completed capture", () => {
  assert.equal(captureSummary(report), null);
  assert.match(
    captureSummary({
      ...report,
      capture: {
        active_hand: "left",
        onset_ms: 100,
        peak_ms: 200,
        end_ms: 300,
        termination: "tracking_lost",
      },
    })!,
    /полные границы не восстановлены/,
  );
});
test("capture completion does not claim a technically correct return", () => {
  const result = {
    ...report,
    capture: {
      active_hand: "left" as const,
      onset_ms: 100,
      peak_ms: 200,
      end_ms: 300,
      termination: "returned" as const,
    },
  };
  assert.match(captureSummary(result)!, /оценивается отдельно/);
  assert.match(
    captureSummary({
      ...result,
      capture: { ...result.capture, termination: "lowered" },
    })!,
    /при опускании/,
  );
});
