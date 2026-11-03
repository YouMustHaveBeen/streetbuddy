import { defineConfig } from "vitest/config";

// The browser tests of the form-filling script; the usual `npm test` does not run them.
export default defineConfig({
  test: {
    include: ["test/userscript/*.browser.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
