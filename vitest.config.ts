import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      // wrangler imports .geojson as text (see [[rules]] in wrangler.toml); tests do the same.
      name: "geojson-as-text",
      enforce: "pre",
      load(id) {
        return id.endsWith(".geojson")
          ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};`
          : null;
      },
    },
  ],
});
