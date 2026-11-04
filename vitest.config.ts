import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // wrangler imports .geojson and .user.js as text (see [[rules]] in wrangler.toml); tests do the same.
      name: "text-assets",
      enforce: "pre",
      load(id) {
        return id.endsWith(".geojson") || id.endsWith(".user.js")
          ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};`
          : null;
      },
    },
  ],
});
