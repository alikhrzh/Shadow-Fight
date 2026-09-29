import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Video lesson</p>" }),
  );
});
test("desktop/mobile layout and camera denied state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Начать урок: Джеб" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Джеб/ })).toBeVisible();
  await expect(page.locator('[data-move="cross"] .hand-label')).toContainText(
    "Задняя рука — правая",
  );
  await page.getByLabel("СТОЙКА").selectOption("southpaw");
  await expect(page.locator('[data-move="cross"] .hand-label')).toContainText(
    "Задняя рука — левая",
  );
  await page.screenshot({ path: "private-data/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "private-data/mobile.png", fullPage: true });
  await page
    .getByRole("button", { name: "Начать урок: Передний боковой" })
    .click();
  await page.getByRole("button", { name: "Перейти к практике →" }).click();
  await expect(page.getByRole("alert")).toContainText(
    /Доступ к камере запрещён|Камера не найдена|Не удалось открыть камеру/,
    { timeout: 20000 },
  );
  await page.getByRole("button", { name: "Выбрать другой удар" }).click();
  await expect(
    page.getByRole("button", { name: "Начать урок: Джеб" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("real MediaPipe worker initializes locally and processes empty image", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r
        .url()
        .startsWith(
          `http://127.0.0.1:${process.env.SHADOW_TEST_PORT ?? 5187}/`,
        ) &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  const result = await page.evaluate(
    async () =>
      await new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = new Worker("/worker/pose.js"),
          timer = setTimeout(() => {
            worker.terminate();
            reject(Error("worker timeout"));
          }, 90000);
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          reject(Error(e.message));
        };
        worker.onmessage = async ({ data }) => {
          if (data.type === "error") {
            clearTimeout(timer);
            worker.terminate();
            reject(Error(data.message));
          }
          if (data.type === "ready") {
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 480;
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "#444";
            ctx.fillRect(0, 0, 640, 480);
            const bitmap = await createImageBitmap(canvas);
            worker.postMessage(
              { type: "frame", bitmap, timestamp: 0, sequence: 1 },
              [bitmap],
            );
          }
          if (data.type === "result") {
            clearTimeout(timer);
            worker.terminate();
            resolve({
              poses: data.frame.pose_count,
              phase: data.live.phase,
              duration: data.duration,
            });
          }
        };
        worker.postMessage({
          type: "init",
          baseUrl: location.origin + "/",
          move: "jab",
          stance: "orthodox",
        });
      }),
  );
  expect(result.poses).toBe(0);
  expect(result.phase).toBe("recovering");
  expect(external).toEqual([]);
});
test("camera stream starts on click, receives model results, and stops all tracks", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const streams: MediaStream[] = [];
    Object.assign(window, { testStreams: streams });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const c = document.createElement("canvas");
        c.width = 640;
        c.height = 480;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#666";
        ctx.fillRect(0, 0, 640, 480);
        const stream = c.captureStream(15);
        streams.push(stream);
        const timer = setInterval(() => {
          ctx.fillStyle = `rgb(${Math.round(performance.now() / 100) % 255},70,80)`;
          ctx.fillRect(0, 0, 640, 480);
          if (stream.getTracks().every((t) => t.readyState === "ended"))
            clearInterval(timer);
        }, 60);
        return stream;
      },
    });
  });
  await page.goto("/");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { testStreams: MediaStream[] }).testStreams
          .length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: /Кросс/ }).click();
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    /youtube-nocookie/,
  );
  await page.getByRole("button", { name: "Перейти к практике →" }).click();
  await expect(page.locator(".training-cue")).toContainText(
    /человек не найден|Обработка кадров слишком медленная/,
    { timeout: 60000 },
  );
  await expect(page.getByText("Проверьте камеру", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Выбрать другой удар" }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { testStreams: MediaStream[] }).testStreams.every(
        (s) => s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
  ).toBe(true);
});
