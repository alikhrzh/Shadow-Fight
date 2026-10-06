import type { AttemptPayload } from "./types";

const key = (userId: string) => `shadowcoach.backend-outbox.v1:${userId}`;

export function readOutbox(userId: string): AttemptPayload[] {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw || raw.length > 250_000) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is AttemptPayload =>
          !!item &&
          typeof item === "object" &&
          typeof (item as AttemptPayload).client_attempt_id === "string",
      )
      .slice(-50);
  } catch {
    return [];
  }
}

export function queueAttempt(userId: string, payload: AttemptPayload): boolean {
  try {
    const items = readOutbox(userId).filter(
      (item) => item.client_attempt_id !== payload.client_attempt_id,
    );
    items.push(payload);
    localStorage.setItem(key(userId), JSON.stringify(items.slice(-50)));
    return true;
  } catch {
    return false;
  }
}

export function removeQueuedAttempt(userId: string, attemptId: string): void {
  try {
    const items = readOutbox(userId).filter(
      (item) => item.client_attempt_id !== attemptId,
    );
    if (items.length) localStorage.setItem(key(userId), JSON.stringify(items));
    else localStorage.removeItem(key(userId));
  } catch {
    // A failed cleanup can only cause an idempotent retry later.
  }
}
