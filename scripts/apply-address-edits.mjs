// One-time script. Takes the file saved from geojson.io (edited copy of the export of the directory)
// and the export (scripts/export-directory.mjs), pairs the changed addresses with the directory rows
// and shows the list "was -> became" for the text, kind and shape. After the answer y it writes the changes
// to the database streetbuddy and checks every row again. It does not add new addresses and does not
// delete anything. If a pair is not clear, or an address breaks the rules of a walk file, nothing is written.
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
const MAX_LENGTH = 100;
const GEOMETRY_TYPES = ["Point", "LineString", "MultiLineString", "Polygon"];
const KINDS = ["house", "appt", "facility", "spot", "area"];
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
// The parts of a geometry as lists of points: a point, a line, the lines, the rings.
const parts = (geometry) =>
  geometry.type === "Point" ? [[geometry.coordinates]] : geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
const toSegment = (p, [a, b]) => {
  const k = Math.cos((53.4 * Math.PI) / 180);
  const [px, py, ax, ay, bx, by] = [p[0] * k, p[1], a[0] * k, a[1], b[0] * k, b[1]];
  const length = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length));
  return metres(p, [(ax + t * (bx - ax)) / k, ay + t * (by - ay)]);
};
const toShape = (p, geometry) =>
  Math.min(...parts(geometry).flatMap((part) => (part.length === 1 ? [metres(p, part[0])] : part.slice(1).map((q, i) => toSegment(p, [part[i], q])))));
// The largest distance from a point of one shape to the other shape, both ways.
const gap = (a, b) => Math.max(...vertices(a).map((p) => toShape(p, b)), ...vertices(b).map((p) => toShape(p, a)));

// The same rules as in scripts/load-walk.mjs.
const isPosition = (p) =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const isLine = (l) => Array.isArray(l) && l.length >= 2 && l.every(isPosition);
function geometryError(geometry) {
  const { type, coordinates } = geometry ?? {};
  if (typeof type !== "string" || !GEOMETRY_TYPES.includes(type)) return `geometry must be Point, LineString, MultiLineString or Polygon, not ${type}`;
  if (type === "Point" && !isPosition(coordinates)) return "the point has no valid coordinates";
  if (type === "LineString" && !isLine(coordinates)) return "the line needs at least 2 valid points";
  if (type === "MultiLineString" && !(Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isLine))) {
    return "every line needs at least 2 valid points";
  }
  if (type === "Polygon") {
    const ring = Array.isArray(coordinates) ? coordinates[0] : null;
    if (!isLine(ring) || ring.length < 4) return "the polygon has no valid ring";
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1]) return "the polygon ring is not closed";
    if (new Set(ring.map(([lon, lat]) => `${lon},${lat}`)).size < 3) return "the polygon needs at least 3 points";
  }
  return null;
}
function kindError(kind, geometryType) {
  if (typeof kind !== "string" || kind === "") return "the kind is missing";
  if (!KINDS.includes(kind)) return `the kind must be ${KINDS.join(", ")}, not ${kind}`;
  if (kind === "area" && geometryType !== "Polygon") return "the kind area needs a Polygon";
  if (kind !== "area" && geometryType === "Polygon") return "a Polygon needs the kind area";
  return null;
}

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

const wrangler = (args, options = {}) =>
  spawnSync("npx", ["wrangler", "d1", "execute", "streetbuddy", "--remote", ...args], {
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
// The rows of the directory with their ids; geometry stays as the text of the database in `raw`.
function readRows() {
  const read = wrangler(["--json", "--command=SELECT id, text, kind, geometry FROM addresses WHERE geometry != ''"], {
    stdio: ["inherit", "pipe", "inherit"],
  });
  try {
    return JSON.parse(read.stdout)[0].results.map((row) => ({ ...row, raw: row.geometry, geometry: JSON.parse(row.geometry) }));
  } catch {
    console.error(`Could not read the directory:\n${read.stdout ?? ""}`);
    process.exit(1);
  }
}

// 1. Pair the addresses of the edited file with the export.
const exported = readFeatures(EXPORT);
const edited = readFeatures(EDITED);
const byShape = (features) => {
  const groups = new Map();
  for (const feature of features) groups.set(shapeKey(feature.geometry), [...(groups.get(shapeKey(feature.geometry)) ?? []), feature]);
  return groups;
};
const exportedGroups = byShape(exported);
const editedGroups = byShape(edited);
const pairs = [];
const unclear = [];
const leftEdited = [];
const leftExported = new Set(exported);
for (const [key, features] of editedGroups) {
  const items = exportedGroups.get(key) ?? [];
  if (items.length === 1 && features.length === 1) {
    pairs.push([items[0], features[0]]);
    leftExported.delete(items[0]);
    continue;
  }
  // Several addresses with one shape: only a pair with the same text is clear.
  const restItems = [...items];
  const restFeatures = [];
  for (const feature of features) {
    const index = restItems.findIndex((item) => sameText(item.properties.address) === sameText(feature.properties.address));
    if (index >= 0) {
      const [item] = restItems.splice(index, 1);
      pairs.push([item, feature]);
      leftExported.delete(item);
    } else {
      restFeatures.push(feature);
    }
  }
  if (restItems.length > 0 && restFeatures.length > 0) {
    for (const feature of restFeatures) unclear.push(`"${feature.properties.address}": ${items.length} addresses of the export have this shape`);
  } else {
    leftEdited.push(...restFeatures);
  }
}

// The rest: a changed shape within MAX_SHIFT_M; the same text first. A pair must be the only one.
const candidatesOf = (feature, pool) => {
  const near = [...pool].filter((item) => item.geometry.type === feature.geometry.type && gap(item.geometry, feature.geometry) <= MAX_SHIFT_M);
  const named = near.filter((item) => sameText(item.properties.address) === sameText(feature.properties.address));
  return named.length > 0 ? named : near;
};
const added = [];
const chosen = new Map();
for (const feature of leftEdited) chosen.set(feature, candidatesOf(feature, leftExported));
for (const [feature, items] of chosen) {
  if (items.length === 0) {
    added.push(feature);
  } else if (items.length > 1) {
    unclear.push(`"${feature.properties.address}": it can be ${items.map((item) => `"${item.properties.address}"`).join(" or ")}`);
  } else {
    const rivals = [...chosen].filter(([other, others]) => other !== feature && others.includes(items[0]));
    if (rivals.length > 0) unclear.push(`"${feature.properties.address}" and "${rivals[0][0].properties.address}" both fit "${items[0].properties.address}"`);
    else {
      pairs.push([items[0], feature]);
      leftExported.delete(items[0]);
    }
  }
}
if (unclear.length > 0) {
  console.error(`Nothing written: these pairs are not clear (change the file or fix them in /admin):\n${unclear.join("\n")}`);
  process.exit(1);
}

// 2. The plan, with the rules of a walk file.
const rows = readRows();
const rowOf = (feature) => {
  const found = rows.filter(
    (row) =>
      row.text === feature.properties.address &&
      row.kind === feature.properties.kind &&
      shapeKey(row.geometry) === shapeKey(feature.geometry),
  );
  return found.length === 1 ? found[0] : null;
};
const plan = [];
const problems = [];
const errors = [];
for (const [before, after] of pairs) {
  const text = tidy(agreed(tidy(after.properties.address ?? before.properties.address)));
  const kind = after.properties.kind ?? before.properties.kind;
  const geometry = after.geometry;
  const changes = [];
  if (text !== before.properties.address) changes.push(`text: "${before.properties.address}" -> "${text}"`);
  if (kind !== before.properties.kind) changes.push(`kind: ${before.properties.kind} -> ${kind}`);
  if (shapeKey(geometry) !== shapeKey(before.geometry)) {
    changes.push(`shape changed (up to ${Math.round(gap(before.geometry, geometry))} m apart)`);
  }
  if (changes.length === 0) continue;
  const where = `"${before.properties.address}"`;
  if (text === "") errors.push(`${where}: the address is missing`);
  else if (text.length > MAX_LENGTH) errors.push(`${where}: the address is longer than ${MAX_LENGTH} characters`);
  const geometryProblem = geometryError(geometry);
  if (geometryProblem) errors.push(`${where}: ${geometryProblem}`);
  const kindProblem = geometryProblem ? null : kindError(kind, geometry.type);
  if (kindProblem) errors.push(`${where}: ${kindProblem}`);
  const row = rowOf(before);
  if (!row) {
    problems.push(`${where}: no single row with this text, kind and shape in the database (changed in /admin after the export, or not unique), not changed.`);
    continue;
  }
  plan.push({ row, text, kind, geometry: { type: geometry.type, coordinates: geometry.coordinates }, changes });
}
if (errors.length > 0) {
  console.error(`Nothing written, fix ${EDITED} first:\n${errors.join("\n")}`);
  process.exit(1);
}

console.log(`${plan.length} addresses will be changed:\n`);
for (const { row, changes } of plan) console.log(`#${row.id} ${changes.join("; ")}`);
if (problems.length > 0) console.log(`\nSkipped:\n${problems.join("\n")}`);
if (leftExported.size > 0) {
  console.log(`\nIn the export but not in ${EDITED} (not deleted here, delete in /admin):`);
  for (const item of leftExported) console.log(`"${item.properties.address}"`);
}
if (added.length > 0) {
  console.log(`\nNew in ${EDITED} (not added here, use diff-directory.mjs after this run):`);
  for (const feature of added) console.log(`"${feature.properties.address}"`);
}
if (plan.length === 0) process.exit(0);

// 3. The answer, the writes and the check of every row.
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
  return `UPDATE addresses SET text = ${quote(text)}, kind = ${quote(kind)}, geometry = ${quote(JSON.stringify(geometry))}, west = ${Math.min(...lons)}, south = ${Math.min(...lats)}, east = ${Math.max(...lons)}, north = ${Math.max(...lats)} WHERE id = ${row.id} AND text = ${quote(row.text)} AND kind = ${quote(row.kind)} AND geometry = ${quote(row.raw)};`;
});
const sqlFile = join(mkdtempSync(join(tmpdir(), "streetbuddy-")), "edits.sql");
writeFileSync(sqlFile, `${statements.join("\n")}\n`);
const result = wrangler([`--file=${sqlFile}`], { stdio: "inherit" });
if (result.status !== 0) console.error("The write reported an error. The rows are checked below.");

const after = readRows();
const failed = plan.filter(({ row, text, kind, geometry }) => {
  const now = after.find((item) => item.id === row.id);
  return !now || now.text !== text || now.kind !== kind || shapeKey(now.geometry) !== shapeKey(geometry);
});
if (failed.length > 0) {
  console.error(`${failed.length} of ${plan.length} addresses were NOT changed (changed in /admin meanwhile, or the write failed):`);
  for (const { row } of failed) console.error(`#${row.id} "${row.text}"`);
  console.error("Run scripts/export-directory.mjs again and repeat the run for them.");
  process.exit(1);
}
console.log(`${plan.length} addresses changed and checked. Run scripts/export-directory.mjs again before the next edit.`);
