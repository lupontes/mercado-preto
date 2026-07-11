import { defineConfig } from "vitest/config"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    root: __dirname,
    include: ["**/__tests__/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
