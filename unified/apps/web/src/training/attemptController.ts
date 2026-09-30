import {
  StreamCoach,
  type LiveUpdate,
} from "../../../../packages/coach-core/src/stream";
import type {
  Frame,
  Move,
  Stance,
} from "../../../../packages/coach-core/src/types";
import { body, guardVisible } from "../gestures/geometry";
import { JabCapture } from "./jabCapture";
export type CaptureMode = "observe" | "calibrate" | "capture";
export class AttemptController {
  private coach: StreamCoach;
  private jab: JabCapture | null;
  private id: string | null = null;
  private calibrated = false;
  private finished = false;
  constructor(move: Move, stance: Stance) {
    this.coach = new StreamCoach(move, stance);
    this.jab = move === "jab" ? new JabCapture(stance) : null;
  }
  reset() {
    this.coach.reset();
    this.jab?.reset();
    this.id = null;
    this.calibrated = false;
    this.finished = false;
  }
  push(
    frame: Frame,
    width: number,
    height: number,
    mode: CaptureMode,
    id: string | null,
  ): LiveUpdate {
    const idle: LiveUpdate = {
      phase: "recovering",
      message: "Подготовьте положение в кадре.",
      result: null,
      bufferSize: 0,
    };
    if (mode === "observe" || !id) {
      this.reset();
      return idle;
    }
    if (id !== this.id) {
      this.reset();
      this.id = id;
    }
    if (this.finished) return idle;
    if (this.jab) {
      if (mode === "capture" && !this.calibrated) return idle;
      const u = this.jab.push(frame, width, height, mode === "capture");
      if (mode === "calibrate") this.calibrated = u.phase === "ready";
      if (u.result) this.finished = true;
      return u;
    }
    if (mode === "calibrate") {
      if (!guardVisible(body(frame, width, height))) {
        this.coach.reset();
        this.calibrated = false;
        return {
          ...idle,
          phase: "calibrating",
          message:
            "Встаньте в боксерскую стойку. Обе кисти у подбородка, локти ниже плеч.",
        };
      }
      const u = this.coach.push(frame, width, height);
      if (u.phase !== "ready") {
        this.calibrated = false;
        if (u.phase === "punch" || u.phase === "return" || u.result)
          this.coach.reset();
      } else this.calibrated = true;
      return { ...u, result: null };
    }
    if (!this.calibrated) return idle;
    const u = this.coach.push(frame, width, height);
    if (u.result) this.finished = true;
    return u;
  }
}
