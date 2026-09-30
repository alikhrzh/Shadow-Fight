import cfg from "../../../../shared/config/defaults.json";
import { analyze, issue } from "../../../../packages/coach-core/src/analyze";
import { compact, distance } from "../../../../packages/coach-core/src/math";
import {
  normalize,
  visible,
} from "../../../../packages/coach-core/src/normalize";
import {
  calibrate,
  speed,
  wrist,
} from "../../../../packages/coach-core/src/segment";
import type { LiveUpdate } from "../../../../packages/coach-core/src/stream";
import {
  emptyPhases,
  hands,
  other,
  type Frame,
  type Hand,
  type Report,
  type Stance,
  type Vec,
  type VideoInfo,
} from "../../../../packages/coach-core/src/types";
import { body, guardVisible } from "../gestures/geometry";
import { detectHandsUp } from "../gestures/detectHandsUp";

/** Live jab boundaries, independent of whether the captured motion can be graded.
 * Raw observations are never repaired or assigned invented confidence. The
 * unchanged core grades only the bounded recording, including all occlusions.
 * This gate targets the head-height jab lesson, not downward/body punches.
 */
export class JabCapture {
  private frames: Frame[] = [];
  private armed = false;
  private lastTime = -1;
  private size = "";
  private candidate: { hand: Hand; time: number; count: number } | null = null;
  private active: Hand | null = null;
  private onset = 0;
  private peakTime = 0;
  private peakRadius = 0;
  private baseline: Vec | null = null;
  private returnPoints: { time: number; point: Vec }[] = [];
  private missingSince: number | null = null;

  constructor(private readonly stance: Stance) {}

  reset() {
    this.clear();
    this.lastTime = -1;
    this.size = "";
  }
  private clear() {
    this.frames = [];
    this.armed = false;
    this.candidate = null;
    this.active = null;
    this.baseline = null;
    this.returnPoints = [];
    this.missingSince = null;
    this.onset = this.peakTime = this.peakRadius = 0;
  }
  private info(width: number, height: number): VideoInfo {
    return {
      width,
      height,
      fps: 30,
      frame_count: this.frames.length,
      duration_ms: this.frames.length
        ? this.frames.at(-1)!.timestamp_ms - this.frames[0].timestamp_ms
        : 0,
    };
  }
  private update(
    phase: LiveUpdate["phase"],
    message: string,
    result: Report | null = null,
  ): LiveUpdate {
    return { phase, message, result, bufferSize: this.frames.length };
  }
  private finish(
    width: number,
    height: number,
    termination: NonNullable<Report["capture"]>["termination"],
    failure?: { code: string; joints: string[] },
  ): LiveUpdate {
    const capture: NonNullable<Report["capture"]> = {
      active_hand: this.active!,
      onset_ms: this.onset,
      peak_ms: this.peakTime,
      end_ms: this.frames.at(-1)!.timestamp_ms,
      termination,
    };
    let result: Report = failure
      ? this.ungraded(failure.code, failure.joints)
      : analyze(this.frames, this.info(width, height), "jab", this.stance);
    if (
      result.status === "completed" &&
      result.metrics?.active_hand !== capture.active_hand
    ) {
      // A later movement of the other hand must not grade a different punch
      // from the one whose boundaries were captured. Never rewrite core metrics.
      result = this.ungraded(
        "ambiguous_attempt",
        [],
        "unreliable",
        "Не удалось отделить одну ударную руку от других движений. Повторите один джеб из неподвижной защиты.",
      );
    }
    result.capture = capture;
    const update = this.update("recovering", "Попытка завершена.", result);
    this.clear();
    return update;
  }
  private ungraded(
    code: string,
    joints: string[] = [],
    status: "unreliable" | "no_attempt" = "unreliable",
    message = issue(code).message,
  ): Report {
    return {
      status,
      expected_move: "jab",
      stance: this.stance,
      score: null,
      phases: emptyPhases(),
      peak_method: null,
      violations: [],
      quality: { issues: [{ ...issue(code, joints), message }] },
      main_feedback: message,
      metrics: null,
      score_components: {},
      effective_weights: {},
    };
  }
  private lowerOnly(point: Vec, baseline: Vec) {
    const dx = point[0] - baseline[0],
      dy = point[1] - baseline[1];
    return dy > cfg.segmentation.min_start_displacement && dy > Math.abs(dx);
  }

  push(
    frame: Frame,
    width: number,
    height: number,
    capture: boolean,
  ): LiveUpdate {
    const now = frame.timestamp_ms;
    if (
      !Number.isFinite(now) ||
      now <= this.lastTime ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return this.update("recovering", "Ожидаем новый кадр камеры.");
    const size = `${width}x${height}`;
    const discontinuity =
      (this.size !== "" && this.size !== size) ||
      (this.lastTime >= 0 && now - this.lastTime > cfg.pose.max_gap_ms);
    this.lastTime = now;
    this.size = size;
    if (!capture && (this.active || this.candidate)) this.clear();
    if (discontinuity) {
      if (this.active)
        return this.finish(width, height, "tracking_lost", {
          code: "low_pose_quality",
          joints: [],
        });
      this.clear();
    }
    if (frame.pose_count > 1 || (frame.pose_count !== 1 && !this.active)) {
      if (this.active)
        return this.finish(width, height, "tracking_lost", {
          code:
            frame.pose_count > 1 ? "multiple_people" : "person_not_detected",
          joints: [],
        });
      this.clear();
      return this.update(
        "calibrating",
        frame.pose_count > 1
          ? "В кадре должен быть один человек."
          : "Вернитесь в кадр и поставьте руки в защиту.",
      );
    }
    this.frames.push({ ...frame, frame: this.frames.length });
    if (!this.active && !this.candidate)
      this.frames = this.frames
        .filter((f) => now - f.timestamp_ms <= 700)
        .map((f, i) => ({ ...f, frame: i }));
    if (this.frames.length > 512) {
      this.frames.pop();
      if (this.active)
        return this.finish(width, height, "tracking_lost", {
          code: "low_pose_quality",
          joints: [],
        });
      this.clear();
      return this.update(
        "calibrating",
        "Замрите в защите для повторной калибровки.",
      );
    }
    const normalized = normalize(this.frames, this.info(width, height), {
      allowImageForeshortening: true,
    });
    const last = normalized.at(-1)!;
    const pose = body(frame, width, height);
    const guard = guardVisible(pose);
    if (!this.armed || !capture) {
      if (!guard) {
        this.clear();
        return this.update(
          "calibrating",
          "Поставьте обе кисти у подбородка и замрите. Пока не бейте.",
        );
      }
      this.armed =
        this.info(width, height).duration_ms >= 500 &&
        hands.every((h) => calibrate(normalized, h) !== null);
      return this.update(
        this.armed ? "ready" : "calibrating",
        this.armed
          ? "Готово. Выполните один джеб и верните руку в защиту."
          : "Фиксируем защиту. Обе кисти должны быть видны.",
      );
    }
    if (this.active && detectHandsUp(pose)) {
      // An asynchronous two-arm raise can initially look like one moving hand.
      // This is only a motion exclusion, never a start/retry gesture command.
      const result = this.ungraded(
        "no_attempt_detected",
        [],
        "no_attempt",
        "Движение похоже на поднятие обеих рук. Отдельный джеб не выделен. Повторите подготовку и выполните один удар из защиты.",
      );
      this.clear();
      return this.update("recovering", result.main_feedback, result);
    }
    if (!this.active) {
      const i = normalized.length - 1;
      const moving = hands.filter((h) => {
        const base = calibrate(normalized, h),
          p = wrist(last, h);
        const prev = i ? wrist(normalized[i - 1], h) : undefined;
        const shoulder = last.smooth_image[`${h}_shoulder`]?.slice(0, 2);
        return (
          base &&
          p &&
          prev &&
          shoulder &&
          !this.lowerOnly(p, base[2]) &&
          distance(p, shoulder) > distance(base[2], shoulder) &&
          distance(p, base[2]) >= cfg.segmentation.min_start_displacement &&
          distance(p, base[2]) >= distance(prev, base[2]) &&
          speed(normalized, i, h) >= cfg.segmentation.movement_speed_threshold
        );
      });
      // Raising both arms is preparation/command, not a single jab. Either
      // anatomical hand may punch: the core still diagnoses a wrong-hand jab.
      if (moving.length === 1) {
        const hand = moving[0];
        if (this.candidate?.hand !== hand)
          this.candidate = { hand, time: now, count: 0 };
        this.candidate.count++;
        const base = calibrate(normalized, hand)![2];
        const p = wrist(last, hand)!;
        const shoulder = last.smooth_image[`${hand}_shoulder`].slice(0, 2);
        if (
          now - this.candidate.time >= cfg.segmentation.confirmation_ms &&
          this.candidate.count >= cfg.segmentation.confirmation_frames &&
          distance(p, base) >= cfg.segmentation.min_attempt_displacement &&
          distance(p, shoulder) - distance(base, shoulder) >=
            cfg.segmentation.min_start_displacement
        ) {
          this.active = hand;
          this.onset = this.candidate.time;
          this.baseline = calibrate(normalized, hand)![2];
          this.peakRadius = distance(wrist(last, hand)!, this.baseline);
          this.peakTime = now;
          this.candidate = null;
        }
      } else {
        this.candidate = null;
        if (!guard || moving.length > 1) {
          this.clear();
          return this.update(
            "calibrating",
            "Подготовка не считается ударом. Верните обе руки в защиту и замрите.",
          );
        }
      }
      if (!this.active)
        return this.update("ready", "Выполните один джеб из защиты.");
    }
    // Only the moving arm and the normalization anchors determine boundaries.
    // The other arm can be occluded; its real missing samples remain in analyze().
    const critical = [
      "left_shoulder",
      "right_shoulder",
      `${this.active}_elbow`,
      `${this.active}_wrist`,
    ];
    const missing = critical.filter(
      (k) => !visible(frame.landmarks[k]) || !last.image[k],
    );
    if (missing.length) {
      this.missingSince ??= now;
      this.returnPoints = [];
      if (now - this.missingSince >= cfg.pose.max_gap_ms)
        return this.finish(width, height, "tracking_lost", {
          code:
            frame.pose_count === 0
              ? "person_not_detected"
              : missing.some((k) => k.endsWith("wrist"))
                ? "wrist_not_visible"
                : "low_pose_quality",
          joints: missing,
        });
      return this.update(
        "recovering",
        "Плечи или ударная рука плохо видны. Удерживаем текущую попытку, ждём точки.",
      );
    }
    this.missingSince = null;
    const p = wrist(last, this.active!)!,
      radius = distance(p, this.baseline!);
    if (this.lowerOnly(p, this.baseline!)) {
      // Do not let a later hand drop replace the extension with a larger peak.
      if (this.peakRadius >= cfg.segmentation.min_attempt_displacement) {
        this.frames.pop();
        return this.finish(width, height, "lowered");
      }
      this.clear();
      return this.update(
        "calibrating",
        "Опускание руки не считается джебом. Вернитесь в защиту.",
      );
    }
    if (radius > this.peakRadius) {
      this.peakRadius = radius;
      this.peakTime = now;
      this.returnPoints = [];
    }
    const threshold = Math.min(
      cfg.jab.max_return_distance,
      this.peakRadius * 0.35,
    );
    if (
      this.peakRadius >= cfg.segmentation.min_attempt_displacement &&
      radius <= threshold
    ) {
      this.returnPoints.push({ time: now, point: p });
      // Keep the trailing stable window. Resetting the whole hold on gradual
      // deceleration discards valid recent samples and delays short clips.
      while (
        this.returnPoints.length > 1 &&
        !compact(
          this.returnPoints.map((p) => p.point),
          cfg.segmentation.max_calibration_spread,
        )
      )
        this.returnPoints.shift();
      if (
        this.returnPoints.length >= cfg.segmentation.confirmation_frames &&
        now - this.returnPoints[0].time >= cfg.segmentation.return_hold_ms &&
        compact(
          this.returnPoints.map((p) => p.point),
          cfg.segmentation.max_calibration_spread,
        )
      )
        return this.finish(width, height, "returned");
    } else this.returnPoints = [];
    if (now - this.onset >= cfg.segmentation.max_attempt_duration_ms + 100)
      return this.finish(width, height, "timeout");
    const hiddenGuard = [
      `${other(this.active!)}_elbow`,
      `${other(this.active!)}_wrist`,
    ].some((k) => !visible(frame.landmarks[k]));
    return this.update(
      radius < this.peakRadius - cfg.segmentation.min_start_displacement
        ? "return"
        : "punch",
      hiddenGuard
        ? "Попытка записывается. Рука в защите плохо видна — оценка может быть недоступна."
        : !visible(frame.landmarks.nose)
          ? "Попытка записывается. Лицо плохо видно — оценка может быть недоступна."
          : "Верните ударную руку в защиту. Опускать руки пока не нужно.",
    );
  }
}
