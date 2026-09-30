import type { Stance } from "../../../../packages/coach-core/src/types";
import { PunchCapture } from "./punchCapture";

/** Backward-compatible entry point for jab-only callers. */
export class JabCapture extends PunchCapture {
  constructor(stance: Stance) {
    super("jab", stance);
  }
}
