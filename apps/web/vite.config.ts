import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envDir: new URL("../../", import.meta.url).pathname,
  plugins: [
    react(),
    {
      name: "local-coach-feedback",
      async configureServer(server) {
        const env = loadEnv(
          "development",
          new URL("../../", import.meta.url).pathname,
          "NVIDIA_",
        );
        for (const [key, value] of Object.entries(env))
          process.env[key] ??= value;
        const { default: handler } = await import("../../api/coach-feedback");
        server.middlewares.use("/api/coach-feedback", (req, res) => {
          void handler(req, res);
        });
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api/v1": {
        target: "http://127.0.0.1:8000",
      },
    },
  },
});
