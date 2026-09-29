import type {
  Frame,
  Move,
  Stance,
} from "../../../../packages/coach-core/src/types";
import type { LiveUpdate } from "../../../../packages/coach-core/src/stream";
export type WorkerInput =
  | { type: "init"; baseUrl: string; move: Move; stance: Stance }
  | { type: "frame"; bitmap: ImageBitmap; timestamp: number; sequence: number }
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
    };
