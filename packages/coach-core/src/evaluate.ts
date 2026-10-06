import cfg from "../../../shared/config/defaults.json";
import { clamp, roundEven } from "./math";
import {
  other,
  type Hand,
  type Metrics,
  type Move,
  type Phases,
  type Violation,
} from "./types";
export const messages: Record<string, string> = {
  wrong_hand:
    "Выполните удар заданной рукой: джеб и хук — передней, кросс — задней.",
  guard_dropped: "Держите свободную руку ближе к подбородку.",
  insufficient_extension:
    "Разгибайте ударную руку полнее, без жёсткой блокировки локтя.",
  low_amplitude: "Выполните удар с более выраженной амплитудой.",
  no_shoulder_rotation: "Добавьте поворот корпуса и плеч во время удара.",
  elbow_too_straight: "На хуке сохраняйте локоть согнутым.",
  elbow_too_bent: "На хуке раскройте угол в локте немного больше.",
  elbow_too_low:
    "На хуке поднимайте ударный локоть приблизительно к уровню плеча.",
  trajectory_not_straight: "Ведите кисть по более прямой траектории.",
  trajectory_too_straight: "Выполняйте хук по дуге с согнутым локтем.",
  not_returned_to_guard:
    "После удара верните руку в защиту и задержитесь в ней.",
  timing_out_of_range:
    "Выполните один отчётливый удар и возврат в удобном темпе.",
};
export const goodFeedback =
  "По измеримым признакам существенных ошибок не найдено. Сохраняйте защиту и возврат.";
export function evaluate(f: Metrics, p: Phases, move: Move) {
  const c = cfg[move],
    s = cfg.scoring,
    result: Violation[] = [];
  const n = (k: string) => f[k] as number,
    available = (k: string) => typeof f[k] === "number";
  const wrist = `${f.active_hand}_wrist`,
    elbow = `${f.active_hand}_elbow`;
  const add = (
    code: string,
    severity: number,
    frame: number | null,
    ...joints: string[]
  ) =>
    result.push({
      code,
      severity: clamp(severity),
      message: messages[code],
      frame,
      related_joints: joints,
    });
  if (f.active_hand !== f.expected_hand)
    add("wrong_hand", 1, p.peak_frame, wrist);
  if (n("wrist_displacement") < c.min_wrist_displacement)
    add(
      "low_amplitude",
      1 - n("wrist_displacement") / c.min_wrist_displacement,
      p.peak_frame,
      wrist,
    );
  if (
    available("other_hand_guard_distance_max") &&
    n("other_hand_guard_distance_max") > c.max_guard_distance
  )
    add(
      "guard_dropped",
      n("other_hand_guard_distance_max") / c.max_guard_distance - 1,
      n("guard_worst_frame"),
      `${other(f.active_hand as Hand)}_wrist`,
    );
  if (!f.returned_to_guard) add("not_returned_to_guard", 1, p.end_frame, wrist);
  if (
    n("duration_ms") < c.min_attempt_duration_ms ||
    n("duration_ms") > c.max_attempt_duration_ms
  )
    add(
      "timing_out_of_range",
      n("duration_ms") > c.max_attempt_duration_ms
        ? n("duration_ms") / c.max_attempt_duration_ms - 1
        : (c.min_attempt_duration_ms - n("duration_ms")) /
            c.min_attempt_duration_ms,
      p.end_frame,
      wrist,
    );
  if (
    move !== "hook" &&
    available("elbow_angle_peak") &&
    n("elbow_angle_peak") < c.min_peak_elbow_angle
  )
    add(
      "insufficient_extension",
      1 - n("elbow_angle_peak") / c.min_peak_elbow_angle,
      p.peak_frame,
      elbow,
    );
  if (
    c.min_shoulder_rotation !== null &&
    available("shoulder_rotation") &&
    n("shoulder_rotation") < c.min_shoulder_rotation
  )
    add(
      "no_shoulder_rotation",
      1 - n("shoulder_rotation") / c.min_shoulder_rotation,
      p.peak_frame,
      "left_shoulder",
      "right_shoulder",
    );
  if (
    move === "jab" &&
    c.min_trajectory_straightness !== null &&
    available("trajectory_straightness") &&
    n("trajectory_straightness") < c.min_trajectory_straightness
  )
    add(
      "trajectory_not_straight",
      1 - n("trajectory_straightness") / c.min_trajectory_straightness,
      p.peak_frame,
      wrist,
    );
  const lateral = available("medial_displacement")
    ? n("medial_displacement")
    : Math.abs(n("horizontal_displacement"));
  if (move === "hook") {
    if (available("elbow_angle_peak")) {
      if (n("elbow_angle_peak") > c.max_peak_elbow_angle)
        add(
          "elbow_too_straight",
          n("elbow_angle_peak") / c.max_peak_elbow_angle - 1,
          p.peak_frame,
          elbow,
        );
      else if (n("elbow_angle_peak") < c.min_peak_elbow_angle)
        add(
          "elbow_too_bent",
          1 - n("elbow_angle_peak") / c.min_peak_elbow_angle,
          p.peak_frame,
          elbow,
        );
    }
    if (
      c.max_elbow_shoulder_vertical_gap &&
      available("elbow_shoulder_vertical_gap") &&
      n("elbow_shoulder_vertical_gap") > c.max_elbow_shoulder_vertical_gap
    )
      add(
        "elbow_too_low",
        n("elbow_shoulder_vertical_gap") / c.max_elbow_shoulder_vertical_gap -
          1,
        p.peak_frame,
        elbow,
      );
    if (
      c.min_horizontal_displacement &&
      lateral < c.min_horizontal_displacement &&
      !result.some((v) => v.code === "low_amplitude")
    )
      add(
        "low_amplitude",
        1 - lateral / c.min_horizontal_displacement,
        p.peak_frame,
        wrist,
      );
    if (
      c.max_trajectory_straightness &&
      available("trajectory_straightness") &&
      n("trajectory_straightness") > c.max_trajectory_straightness
    )
      add(
        "trajectory_too_straight",
        (n("trajectory_straightness") - c.max_trajectory_straightness) /
          (1 - c.max_trajectory_straightness),
        p.peak_frame,
        wrist,
      );
  }
  const components: Record<string, number> = {
    completion: clamp(n("wrist_displacement") / c.min_wrist_displacement),
    return: f.returned_to_guard ? 1 : 0,
  };
  if (move === "hook" && c.min_horizontal_displacement)
    components.completion = clamp(lateral / c.min_horizontal_displacement);
  if (available("elbow_angle_peak")) {
    components.extension = clamp(
      (n("elbow_angle_peak") - s.extension_zero_angle) /
        (s.extension_good_angle - s.extension_zero_angle),
    );
    const center = (c.min_peak_elbow_angle + c.max_peak_elbow_angle) / 2,
      half = (c.max_peak_elbow_angle - c.min_peak_elbow_angle) / 2;
    components.elbow_form = clamp(
      1 -
        Math.max(0, Math.abs(n("elbow_angle_peak") - center) - half) /
          Math.max(half, 1),
    );
  }
  if (available("other_hand_guard_distance_max"))
    components.guard = clamp(
      (s.guard_zero_distance - n("other_hand_guard_distance_max")) /
        (s.guard_zero_distance - s.guard_good_distance),
    );
  if (available("trajectory_straightness"))
    components.trajectory =
      move === "hook" && c.max_trajectory_straightness
        ? clamp(
            (1 - n("trajectory_straightness")) /
              (1 - c.max_trajectory_straightness),
          )
        : n("trajectory_straightness");
  if (available("shoulder_rotation") && c.min_shoulder_rotation)
    components.rotation = clamp(
      n("shoulder_rotation") / c.min_shoulder_rotation,
    );
  if (
    available("elbow_shoulder_vertical_gap") &&
    c.max_elbow_shoulder_vertical_gap
  )
    components.elbow_height = clamp(
      1 -
        Math.max(
          0,
          n("elbow_shoulder_vertical_gap") - c.max_elbow_shoulder_vertical_gap,
        ) /
          c.max_elbow_shoulder_vertical_gap,
    );
  const weights = Object.fromEntries(
    Object.entries(c.weights).filter(([k, v]) => k in components && v > 0),
  );
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const k in weights) weights[k] /= total;
  const used = Object.fromEntries(
    Object.keys(weights).map((k) => [k, components[k]]),
  );
  let score = roundEven(
    100 * Object.entries(weights).reduce((sum, [k, v]) => sum + used[k] * v, 0),
  );
  if (f.active_hand !== f.expected_hand)
    score = Math.min(score, s.wrong_hand_cap);
  const rank = (code: string) => {
    const r = cfg.feedback.priority.indexOf(code);
    return r < 0 ? cfg.feedback.priority.length : r;
  };
  result.sort((a, b) => rank(a.code) - rank(b.code) || b.severity - a.severity);
  return {
    score,
    violations: result.slice(0, cfg.feedback.max_violations_in_report),
    main_feedback: result[0]?.message ?? goodFeedback,
    score_components: used,
    effective_weights: weights,
  };
}
