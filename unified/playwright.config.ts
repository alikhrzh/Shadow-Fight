import { defineConfig } from "@playwright/test";
const port = Number(process.env.SHADOW_TEST_PORT ?? 5187);
export default defineConfig({
  testDir: "./browser-tests",
  timeout: 120000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  reporter: [["list"]],
  webServer: {
    command: `npm run assets && npm run dev -w apps/web -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: { NVIDIA_API_KEY: "" },
    timeout: 120000,
  },
});
