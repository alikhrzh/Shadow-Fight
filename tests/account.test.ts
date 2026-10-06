import assert from "node:assert/strict";
import test from "node:test";
import { emptyPhases, type Report } from "../packages/coach-core/src/types";
import { toAttemptPayload } from "../apps/web/src/account/attemptPayload";
import { BackendClient } from "../apps/web/src/account/backendClient";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const auth = (token: string) => ({
  access_token: token,
  token_type: "bearer",
  expires_in: 900,
  user: {
    id: "c9e78714-b01d-4840-ae17-8d10b2cbfecd",
    email: "boxer@example.com",
    display_name: "Boxer",
    created_at: "2026-09-30T10:00:00Z",
  },
});

test("backend client keeps access token in memory and refreshes once after 401", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let attemptCalls = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/auth/login")) return json(auth("access-one"));
    if (url.includes("/attempts?")) {
      attemptCalls++;
      if (attemptCalls === 1) return json({ detail: "expired" }, 401);
      return json({ items: [], total: 0, limit: 20, offset: 0 });
    }
    if (url.endsWith("/auth/refresh")) return json(auth("access-two"));
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const client = new BackendClient(fetcher, "http://backend.test");

  await client.login({ email: "boxer@example.com", password: "long-password" });
  await client.listAttempts();

  const historyCalls = calls.filter((call) => call.url.includes("/attempts?"));
  assert.equal(historyCalls.length, 2);
  assert.equal(
    new Headers(historyCalls[0]?.init?.headers).get("Authorization"),
    "Bearer access-one",
  );
  assert.equal(
    new Headers(historyCalls[1]?.init?.headers).get("Authorization"),
    "Bearer access-two",
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/auth/refresh")).length,
    1,
  );
  assert.ok(calls.every((call) => call.init?.credentials === "include"));
});

test("attempt payload is privacy-safe and follows the backend allowlist", () => {
  const report: Report = {
    status: "completed",
    expected_move: "jab",
    stance: "orthodox",
    score: 82.4,
    phases: emptyPhases(),
    peak_method: "speed",
    violations: [
      {
        code: "guard_dropped",
        severity: 0.4,
        message: "Keep guard",
        frame: 10,
        related_joints: ["right_wrist", "right_hip"],
      },
      {
        code: "not_a_backend_code",
        severity: 1,
        message: "Unknown",
        frame: 10,
        related_joints: [],
      },
    ],
    quality: { issues: [] },
    main_feedback: "Держите свободную руку ближе к подбородку.",
    metrics: {
      duration_ms: 620,
      active_hand: "left",
      expected_hand: "left",
      returned_to_guard: true,
      guard_worst_frame: 17,
      landmarks: "must-not-leave-device",
    },
    score_components: { completion: 1, guard: 0.72, unknown: 0.2 },
    effective_weights: {},
    confidence_mode: "visibility_only_web",
  };

  const payload = toAttemptPayload(
    "e90ad588-414f-4820-b83e-e5312083fb49",
    report,
    new Date("2026-09-30T10:05:00Z"),
  );

  assert.equal(payload.score, 82);
  assert.deepEqual(payload.metrics, {
    duration_ms: 620,
    active_hand: "left",
    expected_hand: "left",
    returned_to_guard: true,
  });
  assert.deepEqual(payload.score_components, { completion: 1, guard: 0.72 });
  assert.deepEqual(payload.violations, [
    {
      code: "guard_dropped",
      severity: 0.4,
      related_joints: ["right_wrist"],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /landmarks|guard_worst_frame/);
});
