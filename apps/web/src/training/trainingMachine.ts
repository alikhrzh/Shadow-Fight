import type {
  Move,
  Report,
  Stance,
} from "../../../../packages/coach-core/src/types";
import type { CoachFeedback } from "../../../../shared/feedback";
export type TrainingState =
  | "selecting_move"
  | "lesson"
  | "requesting_camera"
  | "camera_setup"
  | "waiting_for_start_gesture"
  | "countdown"
  | "calibrating_guard"
  | "capturing_attempt"
  | "local_analysis"
  | "ai_analysis"
  | "result"
  | "camera_error";
export interface Training {
  state: TrainingState;
  move: Move;
  stance: Stance;
  attemptId: string | null;
  report: Report | null;
  feedback: CoachFeedback | null;
  ai: "idle" | "loading" | "success" | "fallback" | "skipped";
  error: string | null;
}
export const initialTraining: Training = {
  state: "selecting_move",
  move: "jab",
  stance: "orthodox",
  attemptId: null,
  report: null,
  feedback: null,
  ai: "idle",
  error: null,
};
export type Event =
  | { type: "SELECT"; move: Move }
  | { type: "STANCE"; stance: Stance }
  | { type: "PRACTICE" }
  | { type: "CAMERA_READY" }
  | { type: "POSITION"; good: boolean }
  | { type: "START"; attemptId: string }
  | { type: "COUNTDOWN_DONE"; attemptId: string }
  | { type: "GUARD_READY"; attemptId: string }
  | { type: "REPORT"; attemptId: string; report: Report }
  | { type: "ANALYZE"; attemptId: string }
  | { type: "AI_DONE"; attemptId: string; feedback: CoachFeedback | null }
  | { type: "PREPARE_AGAIN" }
  | { type: "PREPARATION_TIMEOUT"; attemptId: string }
  | { type: "ERROR"; message: string }
  | { type: "EXIT" }
  | { type: "HIDDEN" };
export const exitGestureAllowed = (s: TrainingState) =>
  ["camera_setup", "waiting_for_start_gesture", "result"].includes(s);
export const startAllowed = (s: TrainingState) =>
  ["waiting_for_start_gesture", "ai_analysis", "result"].includes(s);
export const cameraActive = (s: TrainingState) =>
  !["selecting_move", "lesson", "camera_error"].includes(s);
export function trainingReducer(s: Training, e: Event): Training {
  if ("attemptId" in e && e.type !== "START" && e.attemptId !== s.attemptId)
    return s;
  switch (e.type) {
    case "EXIT":
    case "HIDDEN":
      return { ...initialTraining, move: s.move, stance: s.stance };
    case "STANCE":
      return s.state === "selecting_move" ? { ...s, stance: e.stance } : s;
    case "SELECT":
      return s.state === "selecting_move"
        ? { ...s, state: "lesson", move: e.move }
        : s;
    case "PRACTICE":
      return ["lesson", "camera_error"].includes(s.state)
        ? { ...s, state: "requesting_camera", error: null, attemptId: null }
        : s;
    case "CAMERA_READY":
      return s.state === "requesting_camera"
        ? { ...s, state: "camera_setup" }
        : s;
    case "POSITION":
      return ["camera_setup", "waiting_for_start_gesture"].includes(s.state)
        ? { ...s, state: e.good ? "waiting_for_start_gesture" : "camera_setup" }
        : s;
    case "START":
      return startAllowed(s.state) && e.attemptId !== s.attemptId
        ? {
            ...s,
            state: "countdown",
            attemptId: e.attemptId,
            report: null,
            feedback: null,
            ai: "idle",
            error: null,
          }
        : s;
    case "COUNTDOWN_DONE":
      return s.state === "countdown" ? { ...s, state: "calibrating_guard" } : s;
    case "GUARD_READY":
      return s.state === "calibrating_guard"
        ? { ...s, state: "capturing_attempt" }
        : s;
    case "REPORT":
      return s.state === "capturing_attempt"
        ? { ...s, state: "local_analysis", report: e.report }
        : s;
    case "ANALYZE":
      return s.state === "local_analysis"
        ? {
            ...s,
            state: s.report?.status === "completed" ? "ai_analysis" : "result",
            ai: s.report?.status === "completed" ? "loading" : "skipped",
          }
        : s;
    case "AI_DONE":
      return s.state === "ai_analysis"
        ? {
            ...s,
            state: "result",
            feedback: e.feedback,
            ai: e.feedback ? "success" : "fallback",
          }
        : s;
    case "PREPARATION_TIMEOUT":
      return s.state === "calibrating_guard"
        ? {
            ...s,
            state: "camera_setup",
            attemptId: null,
            error:
              "Защита не зафиксирована. Поставьте обе кисти у подбородка, локти ниже плеч, затем повторите подготовку.",
          }
        : s;
    case "PREPARE_AGAIN":
      return ["countdown", "calibrating_guard"].includes(s.state)
        ? { ...s, state: "camera_setup", attemptId: null }
        : s;
    case "ERROR":
      return cameraActive(s.state)
        ? {
            ...s,
            state: "camera_error",
            error: e.message,
            attemptId: null,
            ai: s.ai === "loading" ? "fallback" : s.ai,
          }
        : s;
  }
}
