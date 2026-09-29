import type { Report } from "../../../../packages/coach-core/src/types";
import {
  parsePayload,
  metricKeys,
  componentKeys,
  type SafePayload,
} from "../../../../shared/feedback";
export function safePayload(
  report: Report,
  previousScore: number | null = null,
): SafePayload | null {
  if (report.status !== "completed" || report.score === null || !report.metrics)
    return null;
  const metrics: SafePayload["metrics"] = {},
    components: Record<string, number> = {};
  for (const k of [
    ...metricKeys,
    "active_hand",
    "expected_hand",
    "returned_to_guard",
  ])
    if (k in report.metrics) metrics[k] = report.metrics[k];
  for (const k of componentKeys)
    if (k in report.score_components)
      components[k] = report.score_components[k];
  return parsePayload({
    move: report.expected_move,
    stance: report.stance,
    status: report.status,
    score: report.score,
    components,
    metrics,
    violations: report.violations.map((v) => ({
      code: v.code,
      message: v.message,
      severity: v.severity,
    })),
    previous: previousScore === null ? null : { score: previousScore },
  });
}
