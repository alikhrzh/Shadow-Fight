export type Move = "jab" | "hook" | "cross";
export type Stance = "orthodox" | "southpaw";
export type Hand = "left" | "right";
export interface Point {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
  presence_unavailable?: true;
}
export interface Frame {
  frame: number;
  timestamp_ms: number;
  pose_count: number;
  landmarks: Record<string, Point>;
  world_landmarks: Record<string, Point>;
}
export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  duration_ms: number;
}
export type Vec = number[];
export type Space = Record<string, Vec>;
export interface Normalized {
  raw: Frame;
  image: Space;
  world: Space;
  smooth_image: Space;
  smooth_world: Space;
}
export interface Phases {
  guard_start_frame: number | null;
  calibration_end_frame: number | null;
  movement_start_frame: number | null;
  peak_frame: number | null;
  return_frame: number | null;
  end_frame: number | null;
}
export interface Attempt {
  phases: Phases;
  active: Hand | null;
  baseline: Partial<Record<Hand, Vec>>;
  reason: string | null;
  peak_method: string | null;
}
export interface Issue {
  code: string;
  related_joints: string[];
  frame: number | null;
  message: string;
}
export interface Violation extends Issue {
  severity: number;
}
export type Metrics = Record<string, number | string | boolean | null>;
export interface Report {
  /** Local live-capture boundaries, not a technique score or inferred landmarks. */
  capture?: {
    active_hand: Hand;
    onset_ms: number;
    peak_ms: number;
    end_ms: number;
    termination: "returned" | "lowered" | "timeout" | "tracking_lost";
  };
  status: "completed" | "unreliable" | "no_attempt";
  expected_move: Move;
  stance: Stance;
  score: number | null;
  phases: Phases;
  peak_method: string | null;
  violations: Violation[];
  quality: { issues: Issue[] };
  main_feedback: string;
  metrics: Metrics | null;
  score_components: Record<string, number>;
  effective_weights: Record<string, number>;
  confidence_mode?: "visibility_only_web" | "presence_and_visibility";
}
export const names = [
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_pinky",
  "right_pinky",
  "left_index",
  "right_index",
  "left_thumb",
  "right_thumb",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot_index",
  "right_foot_index",
];
export const keyJoints = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
];
export const hands: Hand[] = ["left", "right"];
export const other = (h: Hand): Hand => (h === "left" ? "right" : "left");
export const expectedHand = (move: Move, stance: Stance): Hand => {
  const lead = stance === "orthodox" ? "left" : "right";
  return move === "cross" ? other(lead) : lead;
};
export const emptyPhases = (): Phases => ({
  guard_start_frame: null,
  calibration_end_frame: null,
  movement_start_frame: null,
  peak_frame: null,
  return_frame: null,
  end_frame: null,
});
