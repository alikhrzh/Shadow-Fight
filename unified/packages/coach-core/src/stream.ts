import cfg from "../../../shared/config/defaults.json";
import { analyze, issue, qualityMessages } from "./analyze";
import { normalize, visible } from "./normalize";
import { calibrate, segment, speed, wrist } from "./segment";
import { distance } from "./math";
import {
  emptyPhases,
  expectedHand,
  hands,
  keyJoints,
  type Frame,
  type Move,
  type Report,
  type Stance,
  type VideoInfo,
} from "./types";
export type LivePhase =
  "calibrating" | "ready" | "punch" | "return" | "recovering";
export interface LiveUpdate {
  phase: LivePhase;
  message: string;
  result: Report | null;
  bufferSize: number;
}
/** Bounded pre-roll + one attempt. Results are final, never emitted every frame. */
export class StreamCoach {
  private frames: Frame[] = [];
  private started: number | null = null;
  private candidate: number | null = null;
  private lastTime = -1;
  private lastSize = "";
  private holdUntil = 0;
  private hiddenSince: number | null = null;
  private ready = false;
  private sequence = 0;
  constructor(
    readonly move: Move,
    readonly stance: Stance,
  ) {}
  reset() {
    this.frames = [];
    this.started = null;
    this.candidate = null;
    this.ready = false;
    this.hiddenSince = null;
    this.holdUntil = 0;
    this.lastTime = -1;
    this.lastSize = "";
  }
  private reject(code: string): Report {
    return {
      status: "unreliable",
      expected_move: this.move,
      stance: this.stance,
      score: null,
      phases: emptyPhases(),
      peak_method: null,
      violations: [],
      quality: { issues: [issue(code)] },
      main_feedback: qualityMessages[code],
      metrics: null,
      score_components: {},
      effective_weights: {},
    };
  }
  push(input: Frame, width: number, height: number): LiveUpdate {
    const now = input.timestamp_ms;
    let result: Report | null = null;
    const update = (phase: LivePhase, message: string): LiveUpdate => ({
      phase,
      message,
      result,
      bufferSize: this.frames.length,
    });
    if (
      !Number.isFinite(now) ||
      now <= this.lastTime ||
      width <= 0 ||
      height <= 0
    )
      return update("recovering", "Ожидаем новый кадр камеры.");
    const size = `${width}x${height}`;
    if (
      (this.lastSize && size !== this.lastSize) ||
      (this.lastTime >= 0 && now - this.lastTime > cfg.pose.max_gap_ms)
    ) {
      if (this.started !== null) result = this.reject("low_pose_quality");
      this.frames = [];
      this.started = null;
      this.candidate = null;
      this.ready = false;
      this.hiddenSince = null;
    }
    this.lastTime = now;
    this.lastSize = size;
    const missing = keyJoints.filter((k) => !visible(input.landmarks[k]));
    if (input.pose_count !== 1 || missing.length) {
      this.hiddenSince ??= now;
      const code =
        input.pose_count > 1
          ? "multiple_people"
          : input.pose_count === 0
            ? "person_not_detected"
            : missing.some((k) => k.endsWith("wrist"))
              ? "wrist_not_visible"
              : "low_pose_quality";
      if (
        input.pose_count !== 1 ||
        now - this.hiddenSince >= cfg.pose.max_gap_ms
      ) {
        if (this.started !== null) result = this.reject(code);
        this.frames = [];
        this.started = null;
        this.candidate = null;
        this.ready = false;
      } else if (this.started !== null)
        this.frames.push({ ...input, frame: this.frames.length });
      return update("recovering", qualityMessages[code]);
    }
    this.hiddenSince = null;
    if (now < this.holdUntil)
      return update(
        "recovering",
        "Верните руки в защиту перед следующим ударом.",
      );
    this.frames.push({ ...input, frame: this.frames.length });
    if (this.started === null && this.candidate === null) {
      this.frames = this.frames
        .filter((f) => now - f.timestamp_ms <= 700)
        .map((f, i) => ({ ...f, frame: i }));
    }
    // The frame cap is an additional memory safety limit, not an FPS assumption.
    if (this.frames.length > 512) {
      result = this.started !== null ? this.reject("low_pose_quality") : null;
      this.frames = [];
      this.started = null;
      this.candidate = null;
      this.ready = false;
      return update("calibrating", "Повторите калибровку.");
    }
    const info: VideoInfo = {
      width,
      height,
      fps: 30,
      frame_count: this.frames.length,
      duration_ms: now - this.frames[0].timestamp_ms,
    };
    const normalized = normalize(this.frames, info),
      expected = expectedHand(this.move, this.stance);
    const calibration = calibrate(normalized, expected);
    if (!this.ready) {
      if (!calibration || info.duration_ms < 500)
        return update(
          "calibrating",
          "Замрите в защите на секунду. Обе кисти должны быть видны.",
        );
      this.ready = true;
    }
    if (this.started === null) {
      // Detect onset independently of peak: a hook wind-up may have no medial progress yet.
      const i = normalized.length - 1;
      const moving = hands.some((h) => {
        const base = calibrate(normalized, h),
          p = wrist(normalized[i], h),
          prev = i ? wrist(normalized[i - 1], h) : undefined;
        return (
          base &&
          p &&
          prev &&
          distance(p, base[2]) >= cfg.segmentation.min_start_displacement &&
          distance(p, base[2]) >= distance(prev, base[2]) &&
          speed(normalized, i, h) >= cfg.segmentation.movement_speed_threshold
        );
      });
      if (moving) {
        this.candidate ??= now;
        const count = this.frames.filter(
          (f) => f.timestamp_ms >= this.candidate!,
        ).length;
        if (
          now - this.candidate >= cfg.segmentation.confirmation_ms &&
          count >= cfg.segmentation.confirmation_frames
        )
          this.started = this.candidate;
      } else this.candidate = null;
      if (this.started === null)
        return update(
          "ready",
          "Готово. Выполните один удар и верните руку в защиту.",
        );
    }
    const attempt = segment(normalized, expected, this.move),
      p = attempt.phases;
    const returned =
      p.return_frame !== null &&
      now - this.frames[p.return_frame].timestamp_ms >= 100;
    const expired =
      now - this.started >= cfg.segmentation.max_attempt_duration_ms + 100;
    if (returned || expired) {
      result = analyze(this.frames, info, this.move, this.stance);
      // Attempt was observed; an unsupported attempt must not silently count as no motion.
      if (result.status === "no_attempt")
        result = this.reject("low_pose_quality");
      this.sequence++;
      this.frames = [];
      this.started = null;
      this.candidate = null;
      this.ready = false;
      this.holdUntil = now + 200;
      return update(
        "recovering",
        "Попытка завершена. Подготовьтесь к следующей.",
      );
    }
    return update(
      p.peak_frame !== null && p.peak_frame < normalized.length - 3
        ? "return"
        : "punch",
      "Выполните удар и верните руку. Оценка появится после завершения.",
    );
  }
}
