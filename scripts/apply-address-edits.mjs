// One-time script. Takes the file saved from geojson.io (edited copy of the export of the directory)
// and the export (scripts/export-directory.mjs), pairs the changed addresses with the directory rows
// and shows the list "was -> became" for the text, kind and shape. After the answer y it writes the changes
// to the database streetbuddy. It does not add new addresses and does not delete anything.
// Run from the project folder: node scripts/apply-address-edits.mjs ~/Downloads/map.geojson
// The export file can be given as the second name (the default is exports/directory.geojson).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const EDITED = process.argv[2];
const EXPORT = process.argv[3] ?? "exports/directory.geojson";
const MAX_SHIFT_M = 10;
if (!EDITED) {
  console.error("Name the file saved from geojson.io, for example: node scripts/apply-address-edits.mjs ~/Downloads/map.geojson");
  process.exit(1);
}

const readFeatures = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")).features;
  } catch (error) {
    console.error(`Cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
};

const round = (value) => (Array.isArray(value) ? value.map(round) : Math.round(value * 1e6) / 1e6);
const shapeKey = (geometry) => JSON.stringify([geometry.type, round(geometry.coordinates)]);
const sameText = (text) => String(text).trim().toLowerCase().replace(/\s+/g, " ");
const vertices = (geometry) => {
  const flat = [];
  const walk = (value) => (typeof value[0] === "number" ? flat.push(value) : value.forEach(walk));
  walk(geometry.coordinates);
  return flat;
};
const metres = ([lon1, lat1], [lon2, lat2]) =>
  Math.hypot((lon1 - lon2) * 111320 * Math.cos((53.4 * Math.PI) / 180), (lat1 - lat2) * 110540);
const gap = (a, b) => Math.min(...vertices(a).flatMap((p) => vertices(b).map((q) => metres(p, q))));

// The names fixed for every address: no spaces at the edges, «St» and «Way» with capitals.
const tidy = (text) =>
  String(text)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bst\b/g, "St")
    .replace(/Parkside way\b/g, "Parkside Way");
// The renames that were agreed and are not in the edited file.
const agreed = (text) => {
  const priory = /^Main St, New Priory block (\d+)$/.exec(text);
  if (priory) return `Block ${priory[1]} New Priory, Main St`;
  if (text === "Main St, Block 2c") return "Block 2c, Parkside, Main St";
  if (text === "YMCA") return "YMCA, Main St";
  return text;
};

// 1. The rows of the directory with their ids, read from the database.
const wrangler = (args, options = {}) =>
  spawnSync("npx", ["wrangler", "d1", "execute", "streetbuddy", "--remote", ...args], {
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
const read = wrangler(["--json", "--command=SELECT id, text, kind, geometry FROM addresses WHERE geometry != ''"], {
  stdio: ["inherit", "pipe", "inherit"],
});
let rows;
try {
  rows = JSON.parse(read.stdout)[0].results.map((row) => ({ ...row, geometry: JSON.parse(row.geometry) }));
} catch {
  console.error(`Could not read the directory:\n${read.stdout ?? ""}`);
  process.exit(1);
}
const rowOf = (feature) => {
  const found = rows.filter(
    (row) => row.text === feature.properties.address && shapeKey(row.geometry) === shapeKey(feature.geometry),
  );
  return found.length === 1 ? found[0] : null;
};

// 2. Pair the changed addresses of the edited file with the export.
const exported = readFeatures(EXPORT);
const edited = readFeatures(EDITED);
const exportedByShape = new Map();
for (const feature of exported) exportedByShape.set(shapeKey(feature.geometry), [...(exportedByShape.get(shapeKey(feature.geometry)) ?? []), feature]);
const left = new Set(exported);
const unmatched = [];
const pairs = [];
for (const feature of edited) {
  const same = (exportedByShape.get(shapeKey(feature.geometry)) ?? []).find((item) => left.has(item));
  if (same) {
    left.delete(same);
    pairs.push([same, feature]);
  } else {
    unmatched.push(feature);
  }
}
const candidates = [];
for (const feature of unmatched) {
  for (const item of left) {
    if (item.geometry.type !== feature.geometry.type) continue;
    const near = gap(item.geometry, feature.geometry);
    const sameName = sameText(item.properties.address) === sameText(feature.properties.address);
    if (sameName || near <= MAX_SHIFT_M) candidates.push({ item, feature, near: sameName ? -1 : near });
  }
}
candidates.sort((a, b) => a.near - b.near);
const taken = new Set();
for (const { item, feature } of candidates) {
  if (taken.has(item) || taken.has(feature)) continue;
  taken.add(item);
  taken.add(feature);
  left.delete(item);
  pairs.push([item, feature]);
}
const added = unmatched.filter((feature) => !taken.has(feature));

// 3. The plan.
const plan = [];
const problems = [];
for (const [before, after] of pairs) {
  const text = tidy(agreed(tidy(after.properties.address ?? before.properties.address)));
  const kind = after.properties.kind ?? before.properties.kind;
  const changes = [];
  if (text !== before.properties.address) changes.push(`text: "${before.properties.address}" -> "${text}"`);
  if (kind !== before.properties.kind) changes.push(`kind: ${before.properties.kind} -> ${kind}`);
  if (shapeKey(after.geometry) !== shapeKey(before.geometry)) changes.push("shape changed");
  if (changes.length === 0) continue;
  const row = rowOf(before);
  if (!row) {
    problems.push(`"${before.properties.address}": no single row in the database (it may have been changed in /admin or the text is not unique), not changed.`);
    continue;
  }
  plan.push({ row, text, kind, geometry: after.geometry, changes });
}

console.log(`${plan.length} addresses will be changed:\n`);
for (const { row, changes } of plan) console.log(`#${row.id} ${changes.join("; ")}`);
if (problems.length > 0) console.log(`\nSkipped:\n${problems.join("\n")}`);
if (left.size > 0) {
  console.log(`\nIn the export but not in ${EDITED} (not deleted here, delete in /admin):`);
  for (const item of left) console.log(`"${item.properties.address}"`);
}
if (added.length > 0) {
  console.log(`\nNew in ${EDITED} (not added here, use diff-directory.mjs after this run):`);
  for (const feature of added) console.log(`"${feature.properties.address}"`);
}
if (plan.length === 0) process.exit(0);

// 4. The answer and the writes.
const input = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await input.question("\nApply these changes? (y/n) ")).trim().toLowerCase();
input.close();
if (answer !== "y") {
  console.log("Nothing changed.");
  process.exit(0);
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const statements = plan.map(({ row, text, kind, geometry }) => {
  const points = vertices(geometry);
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return `UPDATE addresses SET text = ${quote(text)}, kind = ${quote(kind)}, geometry = ${quote(JSON.stringify(geometry))}, west = ${Math.min(...lons)}, south = ${Math.min(...lats)}, east = ${Math.max(...lons)}, north = ${Math.max(...lats)} WHERE id = ${row.id} AND text = ${quote(row.text)};`;
});
const sqlFile = join(mkdtempSync(join(tmpdir(), "streetbuddy-")), "edits.sql");
writeFileSync(sqlFile, `${statements.join("\n")}\n`);
const result = wrangler([`--file=${sqlFile}`], { stdio: "inherit" });
if (result.status !== 0) {
  console.error("The database was not changed completely. Run export-directory.mjs again and check.");
  process.exit(1);
}
console.log(`${plan.length} addresses changed. Run scripts/export-directory.mjs again before the next edit.`);
