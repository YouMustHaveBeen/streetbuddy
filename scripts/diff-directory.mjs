// Takes the file saved from geojson.io and the export of the directory (scripts/export-directory.mjs)
// and writes the new walk file config/walks/walk-N.geojson with only the addresses that are not in the
// export: the new ones and the ones whose text, kind or shape changed. Nothing is sent to the database.
// Addresses with the source osm are skipped. If a changed address has the same text as another address of
// the export or as another changed address, nothing is written.
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

// Coordinates are rounded to 6 digits.
const round = (value) => (Array.isArray(value) ? value.map(round) : Math.round(value * 1e6) / 1e6);
const textOf = (feature) => String(feature?.properties?.address ?? "").trim();
const sameTextKey = (feature) => textOf(feature).toLowerCase().replace(/\s+/g, " ");
const placeKey = (feature) => {
  const { type, coordinates } = feature?.geometry ?? {};
  return JSON.stringify([textOf(feature), type, round(coordinates ?? null)]);
};
const keyOf = (feature) => JSON.stringify([placeKey(feature), feature?.properties?.kind ?? null]);

const exported = readFeatures(EXPORT);
const known = new Set(exported.map(keyOf));
const textCounts = new Map();
for (const feature of exported) textCounts.set(sameTextKey(feature), (textCounts.get(sameTextKey(feature)) ?? 0) + 1);
const saved = readFeatures(SAVED);

const changed = [];
const seen = new Set();
const changedByText = new Map();
const errors = [];
let same = 0;
let doubled = 0;
let fromOsm = 0;
for (const feature of saved) {
  const key = keyOf(feature);
  if (known.has(key)) {
    same += 1;
  } else if (feature?.properties?.source === "osm") {
    fromOsm += 1;
  } else if (seen.has(key)) {
    doubled += 1;
  } else {
    seen.add(key);
    const text = textOf(feature);
    const { kind } = feature.properties ?? {};
    const count = textCounts.get(sameTextKey(feature)) ?? 0;
    if (count > 1) errors.push(`"${text}" is in the directory ${count} times: the script cannot tell which one you changed. Fix this address in /admin.`);
    changedByText.set(sameTextKey(feature), [...(changedByText.get(sameTextKey(feature)) ?? []), text]);
    changed.push({ type: "Feature", properties: { address: text, kind }, geometry: feature.geometry });
  }
}

for (const texts of changedByText.values()) {
  if (texts.length > 1) errors.push(`"${texts[0]}" is in ${SAVED} ${texts.length} times as new or changed: the script cannot tell which one is meant. Leave one of them.`);
}
if (errors.length > 0) {
  console.error(`No file written, fix ${SAVED} first:\n${errors.join("\n")}`);
  process.exit(1);
}
if (fromOsm > 0) console.log(`${fromOsm} changed addresses from OSM skipped: fix them in /admin.`);
if (changed.length === 0) {
  console.log(`Nothing new to write (${same} unchanged addresses skipped). No file written.`);
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
