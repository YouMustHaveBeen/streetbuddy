import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// The browser tests of the form-filling script; the usual `npm test` does not run them.
// The base config brings the import of .user.js files as text, which the installation page needs.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/userscript/*.browser.ts"],
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  }),
);
