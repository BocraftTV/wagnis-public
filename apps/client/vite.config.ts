import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";

const apiPort = process.env["PORT"] ?? "3000";

export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ["wagnis-source", ...defaultClientConditions] },
  server: {
    // Dev only: reachable from an iPad via LAN or Tailscale host names.
    allowedHosts: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/healthz": `http://127.0.0.1:${apiPort}`,
      "/ws": { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
