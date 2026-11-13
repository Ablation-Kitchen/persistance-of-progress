import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
  test: {
    // UI tests run the real server in-process (src/test/server.ts).
    alias: {
      "node:sqlite": fileURLToPath(new URL("./src/test/node-sqlite-shim.ts", import.meta.url)),
    },
  },
});
