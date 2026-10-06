import cfg from "../../../../shared/config/defaults.json";

export const CAPTURE_WAIT_MS = 8000;
// The worker's motion limit is 1.8s (+100ms); allow bounded delivery overhead.
const ACTIVE_GRACE_MS = cfg.segmentation.max_attempt_duration_ms + 700;

/** Wall-clock watchdog, independent of the video's source timestamps. */
export function captureWaitRemaining(
  waitStarted: number,
  motionStarted: number | null,
  now: number,
): number {
  return Math.max(
    0,
    Math.max(
      waitStarted + CAPTURE_WAIT_MS,
      motionStarted === null ? 0 : motionStarted + ACTIVE_GRACE_MS,
    ) - now,
  );
}
