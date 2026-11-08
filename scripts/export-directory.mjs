// Writes the address directory of the D1 database streetbuddy to a GeoJSON file, to look at it and
// edit it on geojson.io. Every feature has address, kind and source. The file is not for the repository.
// Run from the project folder: node scripts/export-directory.mjs
// The file name can be given: node scripts/export-directory.mjs exports/my-file.geojson
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.argv[2] ?? "exports/directory.geojson";

const result = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "streetbuddy",
    "--remote",
    "--json",
    "--command=SELECT text, kind, source, geometry FROM addresses WHERE geometry != '' ORDER BY id",
  ],
  {
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["inherit", "pipe", "inherit"],
  },
);

let rows;
try {
  rows = JSON.parse(result.stdout)[0].results;
} catch {
  console.error(`Could not read the directory:\n${result.stdout ?? ""}`);
  process.exit(1);
}

const features = rows.map(({ text, kind, source, geometry }) => ({
  type: "Feature",
  properties: { address: text, kind, source },
  geometry: JSON.parse(geometry),
}));

mkdirSync(dirname(FILE), { recursive: true });
writeFileSync(FILE, `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`);
console.log(`${features.length} addresses written to ${FILE}`);
