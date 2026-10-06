import type { LiveUpdate } from "../../../../packages/coach-core/src/stream";
import type {
  Frame,
  Move,
  Stance,
} from "../../../../packages/coach-core/src/types";
import { PunchCapture } from "./punchCapture";
export type CaptureMode = "observe" | "calibrate" | "capture";
export class AttemptController {
  private punch: PunchCapture;
  private id: string | null = null;
  private calibrated = false;
  private finished = false;
  constructor(move: Move, stance: Stance) {
    this.punch = new PunchCapture(move, stance);
  }
  reset() {
    this.punch.reset();
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
    if (mode === "capture" && !this.calibrated) return idle;
    const u = this.punch.push(frame, width, height, mode === "capture");
    if (mode === "calibrate") this.calibrated = u.phase === "ready";
    if (u.result) this.finished = true;
    return u;
  }
}
