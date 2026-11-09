import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["wagnis-source"] },
  ssr: { resolve: { conditions: ["wagnis-source"] } },
  test: { include: ["src/**/*.test.ts"], server: { deps: { inline: [/@wagnis\//] } } },
});
