import type { Move, Report } from "../../../../packages/coach-core/src/types";
import { messages } from "../../../../packages/coach-core/src/evaluate";
export interface MoveProgress {
  count: number;
  last: number;
  best: number;
  average: number;
  date: string;
  errors: string[];
}
export type Progress = Partial<Record<Move, MoveProgress>>;
export const progressKey = "shadowcoach.progress.v1";
export function readProgress(): Progress {
  try {
    const raw = localStorage.getItem(progressKey);
    if (!raw || raw.length > 6000) return {};
    const parsed = JSON.parse(raw),
      result: Progress = {};
    for (const move of ["jab", "cross", "hook"] as const) {
      const p = parsed?.[move];
      if (
        !p ||
        !Number.isSafeInteger(p.count) ||
        p.count < 1 ||
        ![p.last, p.best, p.average].every(
          (n) =>
            typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100,
        ) ||
        typeof p.date !== "string" ||
        p.date.length > 30 ||
        !Number.isFinite(Date.parse(p.date)) ||
        !Array.isArray(p.errors)
      )
        continue;
      result[move] = {
        count: p.count,
        last: p.last,
        best: p.best,
        average: p.average,
        date: p.date,
        errors: p.errors
          .filter(
            (e: unknown) => typeof e === "string" && Object.hasOwn(messages, e),
          )
          .slice(0, 3),
      };
    }
    return result;
  } catch {
    return {};
  }
}
export function addProgress(old: Progress, r: Report): Progress {
  if (r.status !== "completed" || r.score === null || !Number.isFinite(r.score))
    return old;
  const p = old[r.expected_move],
    count = (p?.count ?? 0) + 1;
  return {
    ...old,
    [r.expected_move]: {
      count,
      last: r.score,
      best: Math.max(p?.best ?? 0, r.score),
      average: ((p?.average ?? 0) * (p?.count ?? 0) + r.score) / count,
      date: new Date().toISOString(),
      errors: r.violations
        .slice(0, 3)
        .map((v) => v.code)
        .filter((k) => Object.hasOwn(messages, k)),
    },
  };
}
export function saveProgress(p: Progress): boolean {
  try {
    localStorage.setItem(progressKey, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
export function clearProgress(): boolean {
  try {
    localStorage.removeItem(progressKey);
    return true;
  } catch {
    return false;
  }
}
