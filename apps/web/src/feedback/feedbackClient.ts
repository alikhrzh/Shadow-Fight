import {
  parseFeedback,
  type CoachFeedback,
  type SafePayload,
} from "../../../../shared/feedback";
export async function requestFeedback(
  payload: SafePayload,
  signal: AbortSignal,
  fetcher = fetch,
  timeoutMs = 18000,
): Promise<CoachFeedback | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (signal.aborted) return null;
    const response = await fetcher("/api/coach-feedback", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok || controller.signal.aborted) return null;
    const text = await response.text();
    if (text.length > 12000 || controller.signal.aborted) return null;
    return parseFeedback(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
