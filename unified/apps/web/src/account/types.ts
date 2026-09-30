import type { Move, Stance } from "../../../../packages/coach-core/src/types";

export interface AccountUser {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: AccountUser;
}

export interface AttemptPayload {
  client_attempt_id: string;
  move: Move;
  stance: Stance;
  status: "completed" | "unreliable" | "no_attempt";
  score: number | null;
  violations: Array<{
    code: string;
    severity: number;
    related_joints: string[];
  }>;
  quality_issues: Array<{ code: string; related_joints: string[] }>;
  metrics: Record<string, number | string | boolean | null> | null;
  score_components: Record<string, number>;
  main_feedback: string;
  confidence_mode?: "visibility_only_web" | "presence_and_visibility";
  analyzer_version: string;
  occurred_at: string;
}

export interface StoredAttempt extends AttemptPayload {
  id: string;
  created_at: string;
}

export interface AttemptPage {
  items: StoredAttempt[];
  total: number;
  limit: number;
  offset: number;
}

export interface MoveProgressSummary {
  move: Move;
  count: number;
  last_score: number | null;
  best_score: number | null;
  average_score: number | null;
  previous_score: number | null;
  trend: number | null;
  last_practiced_at: string | null;
  common_violations: string[];
}

export interface ProgressSummary {
  reliable_attempts: number;
  moves: MoveProgressSummary[];
}

export interface ProgressPoint {
  attempt_id: string;
  move: Move;
  score: number;
  occurred_at: string;
}
