import type {
  Frame,
  Move,
  Stance,
} from "../../../../packages/coach-core/src/types";
import type { LiveUpdate } from "../../../../packages/coach-core/src/stream";
import type { CaptureMode } from "../training/attemptController";
export type WorkerInput =
  | { type: "init"; baseUrl: string; move: Move; stance: Stance }
  | {
      type: "frame";
      bitmap: ImageBitmap;
      timestamp: number;
      sequence: number;
      attemptId: string | null;
      mode: CaptureMode;
    }
  | { type: "reset" };
export type WorkerOutput =
  | { type: "ready"; delegate: string }
  | { type: "error"; message: string }
  | {
      type: "result";
      frame: Frame;
      live: LiveUpdate;
      width: number;
      height: number;
      duration: number;
      sequence: number;
      attemptId: string | null;
      mode: CaptureMode;
    };
