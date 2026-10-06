import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { analyze } from "../packages/coach-core/src/analyze";
import type {
  Frame,
  VideoInfo,
  Move,
  Stance,
} from "../packages/coach-core/src/types";
type Case = {
  id: string;
  frames: Frame[];
  info: VideoInfo;
  move: Move;
  stance: Stance;
  report: Record<string, unknown>;
};
const keys = [
  "status",
  "score",
  "phases",
  "peak_method",
  "metrics",
  "score_components",
  "effective_weights",
];
function compare(a: unknown, b: unknown, path: string, errors: string[]) {
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-7 * Math.max(1, Math.abs(a)))
      errors.push(`${path}: ${a} != ${b}`);
    return;
  }
  if (a && typeof a === "object" && !Array.isArray(a)) {
    for (const [k, v] of Object.entries(a))
      compare(v, (b as Record<string, unknown>)?.[k], `${path}.${k}`, errors);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b))
    errors.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
let total = 0;
const failures: { id: string; errors: string[] }[] = [];
for (const file of [
  "shared/fixtures/synthetic.json",
  "private-data/recorded-parity.json",
]) {
  if (!existsSync(file)) continue;
  for (const c of JSON.parse(readFileSync(file, "utf8")) as Case[]) {
    total++;
    const r = analyze(c.frames, c.info, c.move, c.stance),
      errors: string[] = [];
    for (const k of keys)
      compare(c.report[k], r[k as keyof typeof r], k, errors);
    const oldViolations = c.report.violations as {
      code: string;
      severity: number;
      frame: number | null;
      related_joints: string[];
    }[];
    compare(
      oldViolations.map((v) => v.code),
      r.violations.map((v) => v.code),
      "violations",
      errors,
    );
    oldViolations.forEach((v, i) => {
      if (r.violations[i])
        for (const k of ["severity", "frame", "related_joints"] as const)
          compare(v[k], r.violations[i][k], `violation.${i}.${k}`, errors);
    });
    const quality = c.report.quality as { issues: { code: string }[] };
    compare(
      quality.issues.map((i) => i.code),
      r.quality.issues.map((i) => i.code),
      "quality",
      errors,
    );
    if (errors.length) failures.push({ id: c.id, errors });
  }
}
writeFileSync(
  "private-data/parity-result.json",
  JSON.stringify({ total, passed: total - failures.length, failures }, null, 2),
);
console.log(
  `${total - failures.length}/${total} cases match Python (numeric tolerance 1e-7).`,
);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 8), null, 2));
  process.exitCode = 1;
}
if (!total) throw Error("No fixtures found: run export-reference.py first");
