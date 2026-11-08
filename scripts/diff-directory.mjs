// Takes the file saved from geojson.io and the export of the directory (scripts/export-directory.mjs)
// and writes the new walk file config/walks/walk-N.geojson with only the addresses that are not in the
// export: the new ones and the ones whose text, kind or shape changed. Nothing is sent to the database.
// Run from the project folder: node scripts/diff-directory.mjs ~/Downloads/map.geojson
// The export file can be given as the second name (the default is exports/directory.geojson).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const SAVED = process.argv[2];
const EXPORT = process.argv[3] ?? "exports/directory.geojson";
const WALKS = "config/walks";
if (!SAVED) {
  console.error("Name the file saved from geojson.io, for example: node scripts/diff-directory.mjs ~/Downloads/map.geojson");
  process.exit(1);
}

function readFeatures(file) {
  let collection;
  try {
    collection = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    console.error(`${file} must be a GeoJSON FeatureCollection`);
    process.exit(1);
  }
  return collection.features;
}

// Coordinates are rounded to 6 digits (about 10 cm), because geojson.io may round them when it saves.
const round = (value) => (Array.isArray(value) ? value.map(round) : Math.round(value * 1e6) / 1e6);
const keyOf = (feature) => {
  const { type, coordinates } = feature?.geometry ?? {};
  const text = String(feature?.properties?.address ?? "").trim();
  return JSON.stringify([text, feature?.properties?.kind ?? null, type, round(coordinates ?? null)]);
};

const known = new Set(readFeatures(EXPORT).map(keyOf));
const saved = readFeatures(SAVED);

const changed = [];
const seen = new Set();
let same = 0;
let doubled = 0;
for (const feature of saved) {
  const key = keyOf(feature);
  if (known.has(key)) {
    same += 1;
  } else if (seen.has(key)) {
    doubled += 1;
  } else {
    seen.add(key);
    const { address, kind } = feature.properties ?? {};
    changed.push({ type: "Feature", properties: { address, kind }, geometry: feature.geometry });
  }
}

if (changed.length === 0) {
  console.log(`Nothing new: all ${same} addresses of ${SAVED} are in ${EXPORT}. No file written.`);
  process.exit(0);
}

const numbers = existsSync(WALKS)
  ? readdirSync(WALKS)
      .map((name) => /^walk-(\d+)\.geojson$/.exec(name))
      .filter(Boolean)
      .map((match) => Number(match[1]))
  : [];
const output = `${WALKS}/walk-${Math.max(0, ...numbers) + 1}.geojson`;
writeFileSync(output, `${JSON.stringify({ type: "FeatureCollection", features: changed }, null, 2)}\n`);

console.log(`${changed.length} new or changed addresses written to ${output} (${same} unchanged skipped).`);
if (doubled > 0) console.log(`${doubled} identical duplicates inside ${SAVED} were written once.`);
const incomplete = changed.filter(({ properties }) => !properties.address || !properties.kind).length;
if (incomplete > 0) {
  console.log(`${incomplete} of them have no address or no kind: fill them in on geojson.io before loading (load-walk.mjs will refuse the file).`);
}
