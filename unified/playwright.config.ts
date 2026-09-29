import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser-tests",
  timeout: 120000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5173", headless: true },
  reporter: [["list"]],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
