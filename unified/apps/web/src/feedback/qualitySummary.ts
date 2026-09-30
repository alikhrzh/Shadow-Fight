import type { Report } from "../../../../packages/coach-core/src/types";

const jointNames: Record<string, string> = {
  nose: "лицо",
  left_shoulder: "левое плечо",
  right_shoulder: "правое плечо",
  left_elbow: "левый локоть",
  right_elbow: "правый локоть",
  left_wrist: "левая кисть",
  right_wrist: "правая кисть",
};

/** Collapse repeated window/peak failures without hiding the affected joints. */
export function qualitySummary(report: Report): string[] {
  const grouped = new Map<string, { message: string; joints: Set<string> }>();
  for (const issue of report.quality.issues) {
    const group = grouped.get(issue.code) ?? {
      message: issue.message,
      joints: new Set<string>(),
    };
    for (const joint of issue.related_joints)
      if (jointNames[joint]) group.joints.add(jointNames[joint]);
    grouped.set(issue.code, group);
  }
  return [...grouped.values()].map(({ message, joints }) =>
    joints.size
      ? `${message} Ненадёжные точки: ${[...joints].join(", ")}.`
      : message,
  );
}

export function captureSummary(report: Report): string | null {
  switch (report.capture?.termination) {
    case "returned":
      return "Попытка выделена: начало, пик движения и возврат в защиту.";
    case "lowered":
      return "Рука опущена без подтверждённого возврата в защиту.";
    case "timeout":
      return "Начало попытки обнаружено. Возврат не подтверждён до окончания времени.";
    case "tracking_lost":
      return "Начало попытки обнаружено, но полные границы не восстановлены: потеряно отслеживание.";
    default:
      return null;
  }
}
