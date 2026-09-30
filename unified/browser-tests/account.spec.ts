import { expect, test } from "@playwright/test";

const user = {
  id: "c9e78714-b01d-4840-ae17-8d10b2cbfecd",
  email: "boxer@example.com",
  display_name: "Test Boxer",
  created_at: "2026-09-30T10:00:00Z",
};

test("registration exposes backend history and logout returns to guest mode", async ({
  page,
}) => {
  const calls: string[] = [];
  let signedIn = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/v1/")) {
      await route.fallback();
      return;
    }
    calls.push(`${request.method()} ${path}`);
    if (path.endsWith("/auth/session")) {
      await route.fulfill({ json: { refresh_cookie_present: signedIn } });
      return;
    }
    if (path.endsWith("/auth/refresh")) {
      await route.fulfill({
        json: {
          access_token: "refreshed-access-token",
          token_type: "bearer",
          expires_in: 900,
          user,
        },
      });
      return;
    }
    if (path.endsWith("/auth/register")) {
      expect(request.postDataJSON()).toEqual({
        email: "boxer@example.com",
        password: "strong-password",
        display_name: "Test Boxer",
      });
      signedIn = true;
      await route.fulfill({
        status: 201,
        json: {
          access_token: "access-token",
          token_type: "bearer",
          expires_in: 900,
          user,
        },
      });
      return;
    }
    if (path.endsWith("/progress/summary")) {
      await route.fulfill({
        json: {
          reliable_attempts: 1,
          moves: [
            {
              move: "jab",
              count: 1,
              last_score: 84,
              best_score: 84,
              average_score: 84,
              previous_score: null,
              trend: null,
              last_practiced_at: "2026-09-30T10:05:00Z",
              common_violations: ["guard_dropped"],
            },
            {
              move: "cross",
              count: 0,
              last_score: null,
              best_score: null,
              average_score: null,
              previous_score: null,
              trend: null,
              last_practiced_at: null,
              common_violations: [],
            },
            {
              move: "hook",
              count: 0,
              last_score: null,
              best_score: null,
              average_score: null,
              previous_score: null,
              trend: null,
              last_practiced_at: null,
              common_violations: [],
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/progress/timeline")) {
      await route.fulfill({
        json: [
          {
            attempt_id: "58a3679a-594d-48d9-8c60-06a340827a76",
            move: "jab",
            score: 84,
            occurred_at: "2026-09-30T10:05:00Z",
          },
        ],
      });
      return;
    }
    if (path.endsWith("/attempts")) {
      await route.fulfill({
        json: {
          total: 1,
          limit: 10,
          offset: 0,
          items: [
            {
              id: "58a3679a-594d-48d9-8c60-06a340827a76",
              client_attempt_id: "e90ad588-414f-4820-b83e-e5312083fb49",
              move: "jab",
              stance: "orthodox",
              status: "completed",
              score: 84,
              violations: [],
              quality_issues: [],
              metrics: { duration_ms: 620 },
              score_components: { completion: 1 },
              main_feedback: "Хорошая попытка.",
              confidence_mode: "visibility_only_web",
              analyzer_version: "web-0.2.0",
              occurred_at: "2026-09-30T10:05:00Z",
              created_at: "2026-09-30T10:05:01Z",
            },
          ],
        },
      });
      return;
    }
    if (path.endsWith("/auth/logout")) {
      signedIn = false;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByLabel("Имя").fill("Test Boxer");
  await page.getByLabel("Email").fill("boxer@example.com");
  await page.getByLabel("Пароль").fill("strong-password");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();

  await expect.poll(() => calls).toContain("POST /api/v1/auth/register");
  await expect.poll(() => calls).toContain("GET /api/v1/progress/summary");
  await expect.poll(() => calls).toContain("GET /api/v1/attempts");
  await expect(page.locator(".account-identity")).toContainText("Test Boxer");
  await expect(page.getByText("BACKEND ПОДКЛЮЧЁН")).toBeVisible();
  await expect(page.getByText("84/100", { exact: true })).toBeVisible();
  await expect(page.getByText("1 надёжных попыток")).toBeVisible();

  await page.reload();
  await expect(page.locator(".account-identity")).toContainText("Test Boxer");
  expect(calls).toContain("GET /api/v1/auth/session");
  expect(calls).toContain("POST /api/v1/auth/refresh");

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(
    page.getByRole("button", { name: "Войти" }).first(),
  ).toBeVisible();
  expect(calls).toContain("POST /api/v1/auth/logout");
});
