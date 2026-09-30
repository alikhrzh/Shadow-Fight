import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../shared/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
);
const samples = fixtures.filter((c: { id: string }) =>
  /_30_normal$/.test(c.id),
);
const feedback = {
  headline: "Возврат получился",
  positive: "Рука вернулась в защиту.",
  mainIssue: null,
  correction: "Сохраняйте свободную руку у подбородка.",
  drill: "Выполните один спокойный удар.",
  nextGoal: "Сохраните возврат.",
  motivation: "Продолжайте практику.",
};
async function mockCamera(
  page: Page,
  fakeWorker = true,
  realController = false,
) {
  await page.route("https://www.youtube-nocookie.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<p>Video</p>" }),
  );
  await page.addInitScript(
    ({ samples, fakeWorker, realController }) => {
      const w = window as unknown as {
        testStreams: MediaStream[];
        testPose: string;
        testNoMotion: boolean;
        testGuardMissing: boolean;
        testUnreliable: boolean;
        testWorkers: number;
        testFrames: number;
        testControls: string[];
        testScale: number;
        testMotion: "guard" | "lower" | "punch";
        testOccludeGuard: boolean;
        testMotionOffset: number;
      };
      w.testStreams = [];
      w.testPose = "guard";
      w.testNoMotion = false;
      w.testGuardMissing = false;
      w.testUnreliable = false;
      w.testWorkers = 0;
      w.testFrames = 0;
      w.testControls = [];
      w.testScale = 1;
      w.testMotion = "guard";
      w.testOccludeGuard = false;
      w.testMotionOffset = 0;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          const c = document.createElement("canvas");
          c.width = 640;
          c.height = 480;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = "#888";
          ctx.fillRect(0, 0, 640, 480);
          const stream = c.captureStream(30);
          w.testStreams.push(stream);
          const timer = setInterval(() => {
            ctx.fillStyle = `rgb(130,${100 + (Math.round(performance.now() / 33) % 60)},120)`;
            ctx.fillRect(0, 0, 640, 480);
            if (stream.getTracks().every((t) => t.readyState === "ended"))
              clearInterval(timer);
          }, 30);
          if ((window as any).testDelayCamera)
            await new Promise<void>((resolve) => {
              (window as any).testResolveCamera = resolve;
            });
          return stream;
        },
      });
      if (!fakeWorker) return;
      class FakeWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror = null;
        dead = false;
        index = 0;
        sample = samples[0];
        coach: any = null;
        motionFrame = 0;
        previousMotion = "guard";
        constructor() {
          w.testWorkers++;
        }
        terminate() {
          if (!this.dead) w.testWorkers--;
          this.dead = true;
        }
        async postMessage(data: {
          type: string;
          move: string;
          stance: string;
          mode: string;
          attemptId: string;
          bitmap: ImageBitmap;
          sequence: number;
        }) {
          if (data.type === "init") {
            this.sample = samples.find(
              (c: { move: string; stance: string }) =>
                c.move === data.move && c.stance === data.stance,
            );
            if (realController) {
              // Browser imports the real application controller; only camera
              // pixels/model observations are fixtures in these UI tests.
              const moduleUrl = "/src/training/attemptController.ts";
              const { AttemptController } = await import(moduleUrl);
              this.coach = new AttemptController(data.move, data.stance);
            }
            setTimeout(() => {
              if (!this.dead)
                this.onmessage?.({ data: { type: "ready", delegate: "TEST" } });
            }, 5);
            return;
          }
          if (data.type !== "frame") return;
          data.bitmap.close();
          w.testFrames++;
          w.testControls.push(`${data.mode}:${data.attemptId}`);
          if (data.mode !== "capture" || this.previousMotion !== w.testMotion)
            this.motionFrame = 0;
          this.previousMotion = w.testMotion;
          const motionFrame = this.motionFrame++;
          const frame = structuredClone(
            realController &&
              data.mode === "capture" &&
              w.testMotion === "punch"
              ? this.sample.frames[
                  Math.min(
                    motionFrame + w.testMotionOffset,
                    this.sample.frames.length - 1,
                  )
                ]
              : this.sample.frames[0],
          );
          frame.timestamp_ms = ++this.index * 33;
          if (
            realController &&
            data.mode === "capture" &&
            w.testMotion === "lower"
          ) {
            const amount = Math.min(motionFrame / 12, 1);
            for (const side of ["left", "right"]) {
              frame.landmarks[`${side}_wrist`].y += 0.48 * amount;
              frame.landmarks[`${side}_elbow`].y += 0.15 * amount;
            }
          }
          if (
            realController &&
            w.testOccludeGuard &&
            w.testMotion === "punch" &&
            motionFrame >= 32 &&
            motionFrame <= 43
          ) {
            frame.landmarks.right_wrist.visibility = 0.1;
            frame.landmarks.right_elbow.visibility = 0.1;
          }
          if (w.testPose === "up")
            for (const side of ["left", "right"]) {
              frame.landmarks[`${side}_wrist`].y = 0.06;
              frame.landmarks[`${side}_elbow`].y = 0.23;
            }
          if (w.testPose === "cross") {
            frame.landmarks.left_wrist.x = 0.59;
            frame.landmarks.right_wrist.x = 0.41;
            frame.landmarks.left_wrist.y = frame.landmarks.right_wrist.y = 0.4;
          }
          if (w.testPose === "missing")
            frame.landmarks.left_wrist.visibility = 0;
          for (const p of Object.values(frame.landmarks) as {
            x: number;
            y: number;
          }[]) {
            p.x = 0.5 + (p.x - 0.5) * w.testScale;
            p.y = 0.5 + (p.y - 0.5) * w.testScale;
          }
          const report = w.testUnreliable
            ? {
                ...this.sample.report,
                status: "unreliable",
                score: null,
                metrics: null,
                violations: [],
                main_feedback: "Покажите обе кисти.",
              }
            : this.sample.report;
          const result =
            data.mode === "capture" && !w.testNoMotion ? report : null;
          const actualLive = this.coach?.push(
            frame,
            640,
            480,
            data.mode,
            data.attemptId,
          );
          setTimeout(() => {
            if (!this.dead)
              this.onmessage?.({
                data: {
                  type: "result",
                  frame,
                  width: 640,
                  height: 480,
                  duration: 10,
                  sequence: data.sequence,
                  attemptId: data.attemptId,
                  mode: data.mode,
                  live: actualLive ?? {
                    phase:
                      data.mode === "calibrate" && !w.testGuardMissing
                        ? "ready"
                        : "calibrating",
                    message: "Обе кисти у подбородка.",
                    result,
                    bufferSize: 20,
                  },
                },
              });
          }, 5);
        }
      }
      Object.defineProperty(window, "Worker", { value: FakeWorker });
    },
    { samples, fakeWorker, realController },
  );
}
async function state(page: Page, name: string) {
  await expect(page.locator("main")).toHaveAttribute(
    "data-training-state",
    name,
    { timeout: 20000 },
  );
}
async function practice(page: Page, move = "Джеб", stance = "orthodox") {
  await page.goto("/");
  await page.getByLabel("СТОЙКА").selectOption(stance);
  await page
    .getByRole("button", { name: `Начать урок: ${move}`, exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).testStreams.length)).toBe(0);
  await expect(page.locator("iframe")).toHaveAttribute("loading", "lazy");
  await page.getByRole("button", { name: "Перейти к практике →" }).click();
  await state(page, "waiting_for_start_gesture");
  expect(await page.evaluate(() => (window as any).testStreams.length)).toBe(1);
}
async function stopped(page: Page) {
  await state(page, "selecting_move");
  expect(
    await page.evaluate(() =>
      (window as any).testStreams.every((s: MediaStream) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).testWorkers)).toBe(0);
}
test("real jab controller: lowering is preparation, recovery captures exactly one later jab", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockCamera(page, true, true);
  let calls = 0;
  await page.route("**/api/coach-feedback", async (route) => {
    calls++;
    expect(JSON.stringify(route.request().postDataJSON())).not.toMatch(
      /capture|onset_ms|landmarks/,
    );
    await route.fulfill({ status: 429, json: { error: "unavailable" } });
  });
  await practice(page);
  await page.getByRole("button", { name: "Я готов", exact: true }).click();
  await state(page, "capturing_attempt");
  await page.evaluate(() => {
    (window as any).testMotion = "lower";
  });
  await expect(page.getByTestId("capture-hint")).toContainText(
    /защит|подбородк/,
  );
  await expect(page.locator(".training-cue strong")).toHaveText("В ЗАЩИТУ");
  await expect(page.getByTestId("result")).toHaveCount(0);
  expect(calls).toBe(0);
  await page.evaluate(() => {
    (window as any).testMotion = "guard";
  });
  await expect(page.locator(".training-cue strong")).toHaveText("БЕЙ!");
  await page.evaluate(() => {
    (window as any).testMotion = "punch";
  });
  await state(page, "result");
  await expect(page.getByTestId("capture-summary")).toContainText(
    "возврат в защиту",
  );
  expect(calls).toBe(1);
  await page.waitForTimeout(400);
  expect(calls).toBe(1);
  await page.screenshot({
    path: "private-data/jab-capture-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Выбрать другой удар" }).click();
  await stopped(page);
  expect(errors).toEqual([]);
});

test("real jab controller on mobile: guard occlusion preserves boundaries but no score or AI request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockCamera(page, true, true);
  let calls = 0;
  await page.route("**/api/coach-feedback", async (route) => {
    calls++;
    await route.fulfill({ json: feedback });
  });
  await practice(page);
  await page.evaluate(() => {
    (window as any).testOccludeGuard = true;
  });
  await page.getByRole("button", { name: "Я готов", exact: true }).click();
  await state(page, "capturing_attempt");
  await page.evaluate(() => {
    (window as any).testMotion = "punch";
  });
  await state(page, "result");
  await expect(page.getByTestId("capture-summary")).toContainText(
    "возврат в защиту",
  );
  await expect(page.getByTestId("result")).toContainText("Без балла");
  await expect(page.getByTestId("result")).toContainText("правая кисть");
  await expect(page.getByTestId("result")).toContainText("правый локоть");
  expect(calls).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "private-data/jab-capture-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Выбрать другой удар" }).click();
  await stopped(page);
  expect(errors).toEqual([]);
});

test("late real jab finishes after the waiting deadline instead of becoming no-attempt", async ({
  page,
}) => {
  await mockCamera(page, true, true);
  let calls = 0;
  await page.route("**/api/coach-feedback", async (route) => {
    calls++;
    await route.fulfill({ status: 429, json: { error: "unavailable" } });
  });
  await practice(page);
  await page.getByRole("button", { name: "Я готов", exact: true }).click();
  await state(page, "capturing_attempt");
  const waitingAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(7400);
  await page.evaluate(() => {
    // Guard was already observed for seven seconds; start the motion part
    // of the fixture without adding another synthetic guard pre-roll.
    (window as any).testMotionOffset = 24;
    (window as any).testMotion = "punch";
  });
  await state(page, "result");
  expect(
    (await page.evaluate(() => performance.now())) - waitingAt,
  ).toBeGreaterThan(8000);
  await expect(page.getByTestId("capture-summary")).toContainText(
    "возврат в защиту",
  );
  await expect(page.getByTestId("result")).not.toContainText(
    "Удар не обнаружен",
  );
  expect(calls).toBe(1);
});

test("a candidate turning into two raised arms is not graded or sent to AI", async ({
  page,
}) => {
  await mockCamera(page, true, true);
  let calls = 0;
  await page.route("**/api/coach-feedback", async (route) => {
    calls++;
    await route.fulfill({ json: feedback });
  });
  await practice(page);
  await page.getByRole("button", { name: "Я готов", exact: true }).click();
  await state(page, "capturing_attempt");
  await page.evaluate(() => {
    (window as any).testMotion = "punch";
  });
  await expect(page.locator(".training-cue strong")).toHaveText("УДАР");
  await page.evaluate(() => {
    (window as any).testPose = "up";
  });
  await state(page, "result");
  await expect(page.getByTestId("result")).toContainText(
    "Отдельный джеб не выделен",
  );
  await expect(page.getByTestId("result")).toContainText("Без балла");
  await expect(page.getByTestId("capture-summary")).toHaveCount(0);
  expect(calls).toBe(0);
  // Release the command pose immediately: a subsequent deliberate hold on the
  // result screen remains a legitimate user retry, not an automatic second hit.
  await page.evaluate(() => {
    (window as any).testPose = "guard";
  });
  await state(page, "result");
  await page.getByRole("button", { name: "Выбрать другой удар" }).click();
  await stopped(page);
});
for (const [move, stance, hand] of [
  ["Джеб", "orthodox", "Передняя рука — левая"],
  ["Кросс", "southpaw", "Задняя рука — левая"],
  ["Передний боковой", "southpaw", "Передняя рука — правая"],
]) {
  test(`${move}: lesson, stance, one result, one request, fallback, repeat and exit`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockCamera(page);
    let calls = 0;
    await page.route("**/api/coach-feedback", async (route) => {
      calls++;
      const payload = route.request().postDataJSON();
      expect(payload.stance).toBe(stance);
      expect(JSON.stringify(payload)).not.toMatch(
        /landmarks|world_landmarks|canvas|bitmap|coordinates/,
      );
      await route.fulfill({ status: 429, json: { error: "unavailable" } });
    });
    await practice(page, move, stance);
    await expect(page.locator(".camera-heading")).toContainText(hand);
    await page.getByRole("button", { name: "Я готов", exact: true }).dblclick();
    await state(page, "countdown");
    await state(page, "result");
    await expect(page.getByTestId("result")).toContainText(
      "AI-разбор сейчас недоступен",
    );
    await expect(page.getByTestId("result")).toHaveCount(1);
    expect(calls).toBe(1);
    await page.waitForTimeout(1200);
    await state(page, "result");
    expect(calls).toBe(1);
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await state(page, "result");
    expect(calls).toBe(2);
    await page.getByRole("button", { name: "Выбрать другой удар" }).click();
    await stopped(page);
    await expect(page.getByText("2 надёжных попыток")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test("AI loading keeps local score, validated success and progress survive reload", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await mockCamera(page);
  let finish: (() => void) | undefined;
  await page.route("**/api/coach-feedback", async (r) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await r.fulfill({ json: feedback });
  });
  await practice(page);
  await page.getByRole("button", { name: "Я готов" }).click();
  await state(page, "ai_analysis");
  await expect(page.getByTestId("result")).toContainText("100/100");
  await expect(page.getByTestId("result")).toContainText(
    "AI-тренер готовит объяснение",
  );
  finish!();
  await state(page, "result");
  await expect(page.getByTestId("result")).toContainText("Возврат получился");
  await page.screenshot({
    path: "private-data/training-result-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "private-data/training-result-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByText("1 надёжных попыток")).toBeVisible();
  await page
    .getByRole("button", { name: "Очистить прогресс", exact: true })
    .click();
  await expect(page.getByText("1 надёжных попыток")).toBeVisible();
  await page.getByRole("button", { name: "Да, очистить" }).click();
  await expect(page.getByText("1 надёжных попыток")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
test("real same-origin endpoint without NVIDIA key returns local fallback and preserves camera", async ({
  page,
}) => {
  await mockCamera(page);
  await practice(page);
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/coach-feedback"),
  );
  await page.getByRole("button", { name: "Я готов" }).click();
  expect((await response).status()).toBe(503);
  await state(page, "result");
  await expect(page.getByTestId("result")).toContainText(
    "AI-разбор сейчас недоступен",
  );
  await expect(page.getByTestId("result")).toContainText("100/100");
  expect(
    await page.evaluate(() =>
      (window as any).testStreams.some((s: MediaStream) =>
        s.getTracks().some((t) => t.readyState === "live"),
      ),
    ),
  ).toBe(true);
});
test("late camera permission after exit stops every acquired track", async ({
  page,
}) => {
  await mockCamera(page);
  await page.goto("/");
  await page.evaluate(() => {
    (window as any).testDelayCamera = true;
  });
  await page
    .getByRole("button", { name: "Начать урок: Джеб", exact: true })
    .click();
  await page.getByRole("button", { name: "Перейти к практике →" }).click();
  await state(page, "requesting_camera");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).testResolveCamera))
    .toBe("function");
  await page.getByRole("button", { name: "Выбрать другой удар" }).click();
  await page.evaluate(() => (window as any).testResolveCamera());
  await stopped(page);
});
test("hands up starts and repeats; cross is ignored during punch and exits at result", async ({
  page,
}) => {
  await mockCamera(page);
  await page.route("**/api/coach-feedback", (r) => r.fulfill({ status: 500 }));
  await practice(page);
  await page.evaluate(() => {
    (window as any).testPose = "up";
    (window as any).testNoMotion = true;
  });
  await state(page, "countdown");
  await page.evaluate(() => {
    (window as any).testPose = "cross";
  });
  await state(page, "capturing_attempt");
  await page.waitForTimeout(1600);
  await state(page, "capturing_attempt");
  await page.evaluate(() => {
    (window as any).testPose = "guard";
    (window as any).testNoMotion = false;
  });
  await state(page, "result");
  await page.evaluate(() => {
    (window as any).testPose = "up";
  });
  await state(page, "countdown");
  await page.evaluate(() => {
    (window as any).testPose = "guard";
  });
  await state(page, "result");
  await page.evaluate(() => {
    (window as any).testPose = "cross";
  });
  await stopped(page);
});
test("tab hiding during countdown stops camera, worker and timers; late frames cannot restore state", async ({
  page,
}) => {
  await mockCamera(page);
  await practice(page);
  await page.getByRole("button", { name: "Я готов" }).click();
  await state(page, "countdown");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await stopped(page);
  const frames = await page.evaluate(() => (window as any).testFrames);
  await page.waitForTimeout(3500);
  await state(page, "selecting_move");
  expect(await page.evaluate(() => (window as any).testFrames)).toBe(frames);
});
test("calibration timeout and missing movement permit retry without score or AI call", async ({
  page,
}) => {
  await mockCamera(page);
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/coach-feedback")) requests++;
  });
  await practice(page);
  await page.evaluate(() => {
    (window as any).testGuardMissing = true;
  });
  await page.getByRole("button", { name: "Я готов" }).click();
  await expect(page.getByText(/Защита не зафиксирована/)).toBeVisible({
    timeout: 18000,
  });
  await page.evaluate(() => {
    (window as any).testGuardMissing = false;
    (window as any).testNoMotion = true;
  });
  await page.getByRole("button", { name: "Я готов" }).click();
  await state(page, "result");
  await expect(page.getByTestId("result")).toContainText(
    "Удар не выделен",
  );
  await expect(page.getByTestId("result")).toContainText("Без балла");
  expect(requests).toBe(0);
});
test("unreliable attempt skips NVIDIA and progress; cancel countdown clears timer", async ({
  page,
}) => {
  await mockCamera(page);
  await practice(page);
  await page.evaluate(() => {
    (window as any).testUnreliable = true;
  });
  await page.getByRole("button", { name: "Я готов" }).click();
  await page.getByRole("button", { name: "Отменить отсчёт" }).click();
  await state(page, "waiting_for_start_gesture");
  await page.waitForTimeout(3200);
  await state(page, "waiting_for_start_gesture");
  await page.getByRole("button", { name: "Я готов" }).click();
  await state(page, "result");
  await expect(page.getByTestId("result")).toContainText("Ненадёжная попытка");
  expect(
    await page.evaluate(() => localStorage.getItem("shadowcoach.progress.v1")),
  ).toBeNull();
});
for (const retry of ["button", "gesture"] as const)
  test(`${retry} retry cancels old AI; stale response never replaces next attempt`, async ({
    page,
  }) => {
    await mockCamera(page);
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      (window as any).testAIAborts = 0;
      window.fetch = (input, init) => {
        if (String(input).endsWith("/api/coach-feedback"))
          init?.signal?.addEventListener(
            "abort",
            () => {
              (window as any).testAIAborts++;
            },
            { once: true },
          );
        return originalFetch(input, init);
      };
    });
    let count = 0,
      release: (() => void) | undefined;
    await page.route("**/api/coach-feedback", async (r) => {
      count++;
      if (count === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          await r.fulfill({ json: { ...feedback, headline: "Старый ответ" } });
        } catch {}
      } else await r.fulfill({ json: feedback });
    });
    await practice(page);
    await page.getByRole("button", { name: "Я готов" }).click();
    await state(page, "ai_analysis");
    await expect.poll(() => count).toBe(1);
    await expect(
      page.getByText("Повтор отменит текущий AI-разбор."),
    ).toBeVisible();
    await expect(page.getByLabel("Удержание креста руками")).toHaveCount(0);
    if (retry === "button")
      await page
        .getByRole("button", { name: "Повторить", exact: true })
        .click();
    else
      await page.evaluate(() => {
        (window as any).testPose = "up";
      });
    await state(page, "countdown");
    expect(await page.evaluate(() => (window as any).testAIAborts)).toBe(1);
    await page.evaluate(() => {
      (window as any).testPose = "guard";
    });
    release!();
    await state(page, "result");
    await expect(page.getByText("Старый ответ")).toHaveCount(0);
    await expect(page.getByText("Возврат получился")).toBeVisible();
    expect(count).toBe(2);
  });

test("distant visible gesture starts, strict punch calibration remains, and retry shows missing-wrist reason", async ({
  page,
}) => {
  await mockCamera(page);
  await page.route("**/api/coach-feedback", (r) => r.fulfill({ status: 500 }));
  await practice(page);
  await page.evaluate(() => {
    (window as any).testScale = 0.4;
  });
  await expect(page.getByTestId("attempt-framing-hint")).toContainText(
    "Жест запуска доступен",
  );
  await expect(page.getByTestId("attempt-framing-hint")).toContainText("ближе");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "private-data/gesture-framing-mobile.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    (window as any).testPose = "up";
  });
  await state(page, "countdown");
  await page.evaluate(() => {
    (window as any).testPose = "guard";
  });
  await state(page, "calibrating_guard");
  await expect(page.locator(".training-cue")).toContainText("ближе");
  await page.waitForTimeout(1000);
  await state(page, "calibrating_guard");
  await expect(page.getByTestId("result")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).testScale = 1;
  });
  await state(page, "result");
  await page.evaluate(() => {
    (window as any).testPose = "missing";
  });
  await expect(page.getByTestId("start-gesture-hint")).toContainText(
    "обе кисти",
  );
  await page.screenshot({
    path: "private-data/gesture-retry-hint-mobile.png",
    fullPage: true,
  });
  await page.waitForTimeout(1200);
  await state(page, "result");
  await page.evaluate(() => {
    (window as any).testPose = "up";
    (window as any).testScale = 0.4;
  });
  await state(page, "countdown");
  await page.evaluate(() => {
    (window as any).testPose = "guard";
    (window as any).testScale = 1;
  });
  await state(page, "result");
});
test("responsive selection and lesson work at phone portrait, landscape and tablet sizes", async ({
  page,
}) => {
  await mockCamera(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Начать урок: Кросс" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `private-data/lesson-${viewport.width}.png`,
      fullPage: true,
    });
  }
});
