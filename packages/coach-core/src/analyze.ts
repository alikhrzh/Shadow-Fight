import cfg from "../../../shared/config/defaults.json";
import {
  emptyPhases,
  expectedHand,
  keyJoints,
  type Frame,
  type VideoInfo,
  type Move,
  type Stance,
  type Issue,
  type Report,
} from "./types";
import { normalize, visible } from "./normalize";
import { segment } from "./segment";
import { features } from "./features";
import { evaluate } from "./evaluate";
export const qualityMessages: Record<string, string> = {
  person_not_detected: "Встаньте в кадр: человек не найден.",
  multiple_people: "В кадре должен быть один человек.",
  wrist_not_visible: "Кисть плохо видна. Измените ракурс и освещение.",
  body_out_of_frame: "Нужные суставы вне кадра. Отойдите от камеры.",
  video_too_short: "Недостаточно кадров для оценки.",
  low_pose_quality: "Недостаточно надёжных точек для оценки техники.",
  no_attempt_detected: "Удар не обнаружен. Начните с неподвижной защиты.",
  guard_not_found: "Замрите в защите на секунду для калибровки.",
  hook_peak_ambiguous:
    "Не удалось отделить боковой удар от замаха. Измените ракурс.",
};
export const issue = (
  code: string,
  related_joints: string[] = [],
  frame: number | null = null,
): Issue => ({
  code,
  related_joints,
  frame,
  message: qualityMessages[code] ?? code,
});
export function quality(
  frames: Frame[],
  duration = true,
  coverage = cfg.pose.min_keypoint_coverage,
): Issue[] {
  if (!frames.length) return [issue("person_not_detected")];
  const issues: Issue[] = [];
  if (
    duration &&
    (frames.length < cfg.pose.min_video_frames ||
      frames.at(-1)!.timestamp_ms - frames[0].timestamp_ms <
        cfg.pose.min_video_duration_ms)
  )
    issues.push(issue("video_too_short"));
  if (!frames.some((f) => f.pose_count > 0))
    issues.push(issue("person_not_detected"));
  const multi = frames.filter((f) => f.pose_count > 1);
  if (multi.length >= cfg.pose.multiple_people_frames)
    issues.push(issue("multiple_people", [], multi[0].frame));
  const missing = keyJoints.filter(
    (k) =>
      frames.filter((f) => f.pose_count === 1 && visible(f.landmarks[k]))
        .length /
        frames.length <
      coverage,
  );
  if (
    missing.length &&
    !issues.some((i) =>
      ["person_not_detected", "multiple_people"].includes(i.code),
    )
  ) {
    const cropped = missing.filter(
      (k) =>
        frames.filter((f) => {
          const p = f.landmarks[k];
          return p && !(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
        }).length /
          frames.length >
        1 - coverage,
    );
    if (cropped.length) issues.push(issue("body_out_of_frame", cropped));
    const wrists = missing.filter(
      (k) => k.endsWith("wrist") && !cropped.includes(k),
    );
    if (wrists.length) issues.push(issue("wrist_not_visible", wrists));
    const remaining = missing.filter(
      (k) => !cropped.includes(k) && !wrists.includes(k),
    );
    if (remaining.length) issues.push(issue("low_pose_quality", remaining));
  }
  return issues;
}
export function analyze(
  frames: Frame[],
  info: VideoInfo,
  move: Move,
  stance: Stance,
): Report {
  if (
    !info.width ||
    !info.height ||
    frames.some(
      (f, i) =>
        f.frame !== i ||
        !Number.isFinite(f.timestamp_ms) ||
        (i > 0 && f.timestamp_ms <= frames[i - 1].timestamp_ms),
    )
  )
    throw Error("Invalid frame indices/timestamps/dimensions");
  const report: Report = {
    status: "unreliable",
    expected_move: move,
    stance,
    score: null,
    phases: emptyPhases(),
    peak_method: null,
    violations: [],
    quality: { issues: [] },
    main_feedback: "",
    metrics: null,
    score_components: {},
    effective_weights: {},
  };
  report.confidence_mode = frames.some((f) =>
    Object.values(f.landmarks).some((p) => p.presence_unavailable),
  )
    ? "visibility_only_web"
    : "presence_and_visibility";
  const fail = (
    issues: Issue[],
    status: Report["status"] = "unreliable",
  ): Report => ({
    ...report,
    status,
    quality: { issues },
    main_feedback: issues[0].message,
  });
  const global = quality(frames);
  if (global.length) return fail(global);
  const normalized = normalize(frames, info),
    expected = expectedHand(move, stance);
  if (
    normalized.filter((f) => Object.keys(f.image).length).length /
      normalized.length <
    cfg.pose.min_keypoint_coverage
  )
    return fail([
      issue("low_pose_quality", ["left_shoulder", "right_shoulder"]),
    ]);
  const attempt = segment(normalized, expected, move);
  report.phases = attempt.phases;
  report.peak_method = attempt.peak_method;
  if (attempt.phases.movement_start_frame === null) {
    const reason = attempt.reason ?? "no_attempt_detected";
    return fail(
      [issue(reason)],
      ["guard_not_found", "hook_peak_ambiguous"].includes(reason)
        ? "unreliable"
        : "no_attempt",
    );
  }
  const p = attempt.phases,
    start = p.movement_start_frame!,
    end = p.end_frame!,
    peak = p.peak_frame!,
    window = frames.slice(start, end + 1),
    local = quality(window, false);
  for (const joint of keyJoints) {
    let missingSince: number | null = null;
    for (const f of normalized.slice(start, end + 1)) {
      if (!(joint in f.image)) {
        missingSince ??= f.raw.timestamp_ms;
        if (f.raw.timestamp_ms - missingSince >= cfg.pose.max_gap_ms) {
          local.push(issue("low_pose_quality", [joint], f.raw.frame));
          break;
        }
      } else missingSince = null;
    }
  }
  const peakIssues = quality(
    window.filter(
      (f) =>
        Math.abs(f.timestamp_ms - frames[peak].timestamp_ms) <=
        cfg.pose.peak_window_ms,
    ),
    false,
    cfg.pose.min_peak_coverage,
  );
  if (!keyJoints.every((k) => k in normalized[peak].image))
    peakIssues.push(issue("low_pose_quality", [], peak));
  if (!(`${attempt.active}_wrist` in normalized[end].image))
    local.push(issue("wrist_not_visible", [], end));
  if (local.length || peakIssues.length) return fail([...local, ...peakIssues]);
  const metrics = features(normalized, attempt, expected);
  if (metrics.elbow_angle_peak === null)
    return fail([issue("low_pose_quality", [`${attempt.active}_elbow`], peak)]);
  return {
    ...report,
    status: "completed",
    metrics,
    ...evaluate(metrics, p, move),
  };
}
