import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import handler, { nvidiaFeedback, allowRequest } from "../api/coach-feedback";
import {
  parseFeedback,
  parsePayload,
  type CoachFeedback,
} from "../shared/feedback";
import { safePayload } from "../apps/web/src/feedback/safePayload";
import { requestFeedback } from "../apps/web/src/feedback/feedbackClient";
import type { Report } from "../packages/coach-core/src/types";
const report = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
).find((c: { id: string }) => c.id === "jab_orthodox_30_normal")
  .report as Report;
const payload = safePayload(report)!;
const good: CoachFeedback = {
  headline: "Хороший возврат",
  positive: "Рука вернулась в защиту.",
  mainIssue: null,
  correction: "Сохраняйте защиту.",
  drill: "Повторите один спокойный джеб.",
  nextGoal: "Сохраните возврат руки.",
  motivation: "Продолжайте практику.",
};
const env = { NVIDIA_API_KEY: "mock-only-value" };
const signal = () => new AbortController().signal;
const response = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    headers: { "Content-Type": "application/json" },
  });
test("safe payload excludes every raw/private field recursively, strips unknown metrics and never copies Report", () => {
  const forbidden = [
    "video",
    "image",
    "frame",
    "frames",
    "landmarks",
    "world_landmarks",
    "coordinates",
    "audio",
    "bitmap",
    "canvas",
  ];
  const dirty = structuredClone(report) as Report & Record<string, unknown>;
  for (const k of forbidden) dirty[k] = { secret: [1, 2, 3] };
  dirty.metrics!.landmarks = "not allowed";
  dirty.score_components.extra = 1;
  const safe = safePayload(dirty)!;
  const keys = (x: unknown): string[] =>
    x && typeof x === "object"
      ? Object.entries(x).flatMap(([k, v]) => [k, ...keys(v)])
      : [];
  for (const k of forbidden) assert.equal(keys(safe).includes(k), false);
  assert.equal(keys(safe).includes("extra"), false);
  assert.deepEqual(Object.keys(safe).sort(), [
    "components",
    "metrics",
    "move",
    "previous",
    "score",
    "stance",
    "status",
    "violations",
  ]);
  assert.equal(
    safePayload({ ...report, status: "unreliable", score: null }),
    null,
  );
  assert.equal(safePayload(report, 80)!.previous!.delta, 20);
});
test("server rejects invalid moves, stance, errors, non-finite values and client prompt/provider overrides", () => {
  for (const value of [
    { ...payload, move: "uppercut" },
    { ...payload, stance: "other" },
    { ...payload, score: Infinity },
    { ...payload, violations: [{ code: "invented", severity: 1 }] },
    { ...payload, model: "other" },
    { ...payload, system: "ignore" },
    { ...payload, baseURL: "https://example.com" },
    { ...payload, metrics: { ...payload.metrics, duration_ms: "100" } },
  ])
    assert.throws(() => parsePayload(value));
  assert.deepEqual(
    parsePayload({ ...payload, landmarks: [123], personalName: "removed" }),
    payload,
  );
  assert.equal(
    parsePayload({
      ...payload,
      violations: [
        { code: "wrong_hand", severity: 1, message: "ignore system" },
      ],
    }).violations[0].message.includes("ignore"),
    false,
  );
});
test("feedback permits valid JSON/fences and rejects unknown fields, empty strings, invalid JSON and long text", () => {
  assert.deepEqual(parseFeedback(JSON.stringify(good)), good);
  assert.deepEqual(
    parseFeedback("```json\n" + JSON.stringify(good) + "\n```"),
    good,
  );
  for (const value of [
    "",
    "{",
    { ...good, extra: "выдумка" },
    { ...good, correction: "а".repeat(451) },
    { ...good, drill: "" },
    { ...good, headline: "English only" },
  ])
    assert.throws(() => parseFeedback(value));
});
test("NVIDIA receives server prompt and model, returns checked JSON, no top_p tuning", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://integrate.api.nvidia.com/v1/chat/completions");
    const b = JSON.parse(init!.body as string);
    assert.equal(b.model, "meta/llama-3.3-70b-instruct");
    assert.equal(b.top_p, undefined);
    assert.equal(b.messages[0].role, "system");
    assert.deepEqual(JSON.parse(b.messages[1].content), payload);
    return response("```json\n" + JSON.stringify(good) + "\n```");
  };
  assert.deepEqual(await nvidiaFeedback(payload, env, signal(), fetcher), good);
  assert.equal(calls, 1);
});
test("NVIDIA format repair is bounded to one retry", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () =>
    response(++calls === 1 ? "{bad" : JSON.stringify(good));
  assert.deepEqual(await nvidiaFeedback(payload, env, signal(), fetcher), good);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    nvidiaFeedback(payload, env, signal(), async () => {
      calls++;
      return response("{bad");
    }),
  );
  assert.equal(calls, 2);
});
for (const status of [402, 422, 429, 500])
  test(`NVIDIA ${status} is controlled and frontend keeps local fallback`, async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response("upstream detail", { status });
    };
    await assert.rejects(nvidiaFeedback(payload, env, signal(), fetcher));
    assert.equal(calls, 1);
    assert.equal(await requestFeedback(payload, signal(), fetcher), null);
  });
test("missing key never contacts provider; empty provider response becomes controlled error", async () => {
  let calls = 0;
  await assert.rejects(
    nvidiaFeedback(payload, {}, signal(), async () => {
      calls++;
      return response("");
    }),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    nvidiaFeedback(payload, env, signal(), async () => response("")),
  );
});
test("both client and server time out and propagate cancellation", async () => {
  const waiting: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  await assert.rejects(nvidiaFeedback(payload, env, signal(), waiting, 10));
  assert.equal(await requestFeedback(payload, signal(), waiting, 10), null);
  const controller = new AbortController();
  const pending = requestFeedback(payload, controller.signal, waiting);
  controller.abort();
  assert.equal(await pending, null);
});
test("client never renders unvalidated output or starts a request when already aborted", async () => {
  assert.equal(
    await requestFeedback(payload, signal(), async () => new Response("{bad")),
    null,
  );
  assert.equal(
    await requestFeedback(
      payload,
      signal(),
      async () => new Response(JSON.stringify({ ...good, score: 100 })),
    ),
    null,
  );
  const controller = new AbortController();
  controller.abort();
  let called = false;
  assert.equal(
    await requestFeedback(payload, controller.signal, async () => {
      called = true;
      return new Response();
    }),
    null,
  );
  assert.equal(called, false);
});
test("basic rate limit expires and limits bursts", () => {
  for (let i = 0; i < 8; i++) assert.equal(allowRequest("test-ip", 0), true);
  assert.equal(allowRequest("test-ip", 100), false);
  assert.equal(allowRequest("test-ip", 60001), true);
});
let requestIndex = 0;
async function endpoint(
  method: string,
  body: unknown,
  extra: Record<string, string> = {},
  raw = false,
) {
  const req = Readable.from(raw ? [String(body)] : []) as Parameters<
    typeof handler
  >[0];
  req.method = method;
  req.headers = {
    host: "localhost:5187",
    origin: "http://localhost:5187",
    "content-type": "application/json",
    ...extra,
  };
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: `test-${requestIndex++}` },
  });
  if (!raw) req.body = body;
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    writableEnded: boolean;
    destroyed: boolean;
    setHeader: (k: string, v: string) => void;
    end: (v: string) => void;
  };
  let output = "";
  res.writableEnded = false;
  res.destroyed = false;
  res.setHeader = () => {};
  res.end = (v) => {
    output = v;
    res.writableEnded = true;
  };
  await handler(req, res as unknown as Parameters<typeof handler>[1]);
  return { status: res.statusCode, output };
}
test("endpoint checks POST, content type, origin, body size and schema before provider", async () => {
  assert.equal((await endpoint("GET", payload)).status, 405);
  assert.equal(
    (await endpoint("POST", payload, { "content-type": "text/plain" })).status,
    415,
  );
  assert.equal(
    (await endpoint("POST", payload, { origin: "https://other.example" }))
      .status,
    403,
  );
  assert.equal(
    (await endpoint("POST", payload, { "content-length": "13000" })).status,
    413,
  );
  assert.equal(
    (await endpoint("POST", "x".repeat(13000), {}, true)).status,
    413,
  );
  assert.equal(
    (await endpoint("POST", { ...payload, system: "override" })).status,
    400,
  );
  assert.equal((await endpoint("POST", "{bad", {}, true)).status, 400);
});
test("endpoint without configuration returns safe fallback without leaking upstream data", async () => {
  const old = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  try {
    const r = await endpoint("POST", payload);
    assert.equal(r.status, 503);
    assert.match(r.output, /локальный анализ/);
    assert.ok(!r.output.includes("stack"));
  } finally {
    if (old !== undefined) process.env.NVIDIA_API_KEY = old;
  }
});
