import type { Move, Stance } from "../packages/coach-core/src/types";
import { messages } from "../packages/coach-core/src/evaluate";
export interface CoachFeedback {
  headline: string;
  positive: string;
  mainIssue: string | null;
  correction: string;
  drill: string;
  nextGoal: string;
  motivation: string;
}
export const feedbackLimits = {
  headline: 120,
  positive: 350,
  mainIssue: 350,
  correction: 450,
  drill: 450,
  nextGoal: 250,
  motivation: 200,
};
export function parseFeedback(value: unknown): CoachFeedback {
  if (typeof value === "string")
    value = JSON.parse(
      value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("invalid_feedback");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 7 ||
    Object.keys(v).some((k) => !(k in feedbackLimits))
  )
    throw Error("invalid_feedback");
  for (const [k, max] of Object.entries(feedbackLimits)) {
    if (k === "mainIssue" && v[k] === null) continue;
    if (
      typeof v[k] !== "string" ||
      !v[k].trim() ||
      v[k].length > max ||
      !/[а-яё]/i.test(v[k])
    )
      throw Error("invalid_feedback");
  }
  return {
    headline: v.headline as string,
    positive: v.positive as string,
    mainIssue: v.mainIssue as string | null,
    correction: v.correction as string,
    drill: v.drill as string,
    nextGoal: v.nextGoal as string,
    motivation: v.motivation as string,
  };
}
export const metricKeys = [
  "duration_ms",
  "max_wrist_speed",
  "wrist_displacement",
  "horizontal_displacement",
  "medial_displacement",
  "vertical_displacement",
  "depth_displacement",
  "elbow_angle_start",
  "elbow_angle_peak",
  "elbow_angle_range",
  "max_elbow_angle",
  "other_hand_guard_distance_max",
  "other_hand_guard_distance_mean",
  "guard_distance_peak",
  "shoulder_rotation",
  "elbow_shoulder_vertical_gap",
  "trajectory_straightness",
  "return_distance",
] as const;
export const componentKeys = [
  "completion",
  "return",
  "extension",
  "elbow_form",
  "guard",
  "trajectory",
  "rotation",
  "elbow_height",
] as const;
export interface SafePayload {
  move: Move;
  stance: Stance;
  status: "completed";
  score: number;
  components: Record<string, number>;
  violations: { code: string; message: string; severity: number }[];
  metrics: Record<string, number | boolean | string | null>;
  previous: { score: number; delta: number } | null;
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("invalid_payload");
  return v as Record<string, unknown>;
};
const number = (v: unknown, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw Error("invalid_payload");
  return v;
};
/** Both boundaries reconstruct an allowlist; client strings never become prompt instructions. */
export function parsePayload(value: unknown): SafePayload {
  const v = record(value);
  if (
    ["model", "system", "prompt", "messages", "baseURL", "baseUrl", "url"].some(
      (k) => k in v,
    )
  )
    throw Error("invalid_payload");
  if (
    !["jab", "cross", "hook"].includes(v.move as string) ||
    !["orthodox", "southpaw"].includes(v.stance as string) ||
    v.status !== "completed"
  )
    throw Error("invalid_payload");
  const components: Record<string, number> = {},
    metrics: SafePayload["metrics"] = {};
  const c = record(v.components),
    m = record(v.metrics);
  for (const k of componentKeys) if (k in c) components[k] = number(c[k], 0, 1);
  for (const k of metricKeys)
    if (k in m)
      metrics[k] = m[k] === null ? null : number(m[k], -100000, 100000);
  for (const k of ["active_hand", "expected_hand"])
    if (k in m) {
      if (!["left", "right"].includes(m[k] as string))
        throw Error("invalid_payload");
      metrics[k] = m[k] as string;
    }
  if ("returned_to_guard" in m) {
    if (typeof m.returned_to_guard !== "boolean")
      throw Error("invalid_payload");
    metrics.returned_to_guard = m.returned_to_guard;
  }
  if (!Array.isArray(v.violations) || v.violations.length > 5)
    throw Error("invalid_payload");
  const violations = v.violations.map((raw) => {
    const i = record(raw);
    if (typeof i.code !== "string" || !Object.hasOwn(messages, i.code))
      throw Error("invalid_payload");
    return {
      code: i.code,
      message: messages[i.code],
      severity: number(i.severity, 0, 1),
    };
  });
  const score = number(v.score, 0, 100);
  let previous: SafePayload["previous"] = null;
  if (v.previous != null) {
    const prior = number(record(v.previous).score, 0, 100);
    previous = { score: prior, delta: score - prior };
  }
  return {
    move: v.move as Move,
    stance: v.stance as Stance,
    status: "completed",
    score,
    components,
    violations,
    metrics,
    previous,
  };
}
