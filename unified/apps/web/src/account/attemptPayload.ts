import type { Report } from "../../../../packages/coach-core/src/types";
import { componentKeys, metricKeys } from "../../../../shared/feedback";
import type { AttemptPayload } from "./types";

const violationCodes = new Set([
  "wrong_hand",
  "guard_dropped",
  "insufficient_extension",
  "low_amplitude",
  "no_shoulder_rotation",
  "elbow_too_straight",
  "elbow_too_bent",
  "elbow_too_low",
  "trajectory_not_straight",
  "trajectory_too_straight",
  "not_returned_to_guard",
  "timing_out_of_range",
]);
const qualityCodes = new Set([
  "person_not_detected",
  "multiple_people",
  "wrist_not_visible",
  "body_out_of_frame",
  "video_too_short",
  "low_pose_quality",
  "no_attempt_detected",
  "guard_not_found",
  "hook_peak_ambiguous",
  "ambiguous_attempt",
]);
const joints = new Set([
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
]);
const extraMetricKeys = [
  "active_hand",
  "expected_hand",
  "returned_to_guard",
  "angle_coordinate_space",
  "rotation_coordinate_space",
  "motion_coordinate_space",
] as const;

const safeJoints = (values: string[]) =>
  values.filter((joint) => joints.has(joint)).slice(0, 7);

export function toAttemptPayload(
  clientAttemptId: string,
  report: Report,
  occurredAt = new Date(),
): AttemptPayload {
  const metrics: AttemptPayload["metrics"] = report.metrics ? {} : null;
  if (metrics && report.metrics) {
    for (const key of [...metricKeys, ...extraMetricKeys]) {
      const value = report.metrics[key];
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
        metrics[key] = value;
    }
  }
  const scoreComponents: Record<string, number> = {};
  for (const key of componentKeys) {
    const value = report.score_components[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1
    )
      scoreComponents[key] = value;
  }
  return {
    client_attempt_id: clientAttemptId,
    move: report.expected_move,
    stance: report.stance,
    status: report.status,
    score:
      report.status === "completed" && report.score !== null
        ? Math.max(0, Math.min(100, Math.round(report.score)))
        : null,
    violations: report.violations
      .filter((violation) => violationCodes.has(violation.code))
      .slice(0, 5)
      .map((violation) => ({
        code: violation.code,
        severity: Math.max(0, Math.min(1, violation.severity)),
        related_joints: safeJoints(violation.related_joints),
      })),
    quality_issues: report.quality.issues
      .filter((issue) => qualityCodes.has(issue.code))
      .slice(0, 10)
      .map((issue) => ({
        code: issue.code,
        related_joints: safeJoints(issue.related_joints),
      })),
    metrics,
    score_components: scoreComponents,
    main_feedback:
      report.main_feedback.trim().slice(0, 500) ||
      "Попытка сохранена без текстовой подсказки.",
    ...(report.confidence_mode
      ? { confidence_mode: report.confidence_mode }
      : {}),
    analyzer_version: "web-0.2.0",
    occurred_at: occurredAt.toISOString(),
  };
}
