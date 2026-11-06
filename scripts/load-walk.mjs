// Loads one walk file into the incoming addresses of the D1 database streetbuddy, without a
// decision. A file is loaded once: its name is kept in walk_files, and a file with a name already
// there is refused. If any feature is wrong, nothing is loaded.
// Run from the project folder: node scripts/load-walk.mjs config/walks/walk-1.geojson
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const FILE = process.argv[2];
if (!FILE) {
  console.error("Name the walk file, for example: node scripts/load-walk.mjs config/walks/walk-1.geojson");
  process.exit(1);
}
const NAME = basename(FILE);
const MAX_LENGTH = 100;
const KINDS = { Point: "point", LineString: "line", MultiLineString: "line", Polygon: "area" };

const isPosition = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isLine = (l) => Array.isArray(l) && l.length >= 2 && l.every(isPosition);

// Returns the reason a geometry is wrong, or null.
function geometryError(geometry) {
  const { type, coordinates } = geometry ?? {};
  if (!(type in KINDS)) return `geometry must be Point, LineString, MultiLineString or Polygon, not ${type}`;
  if (type === "Point" && !isPosition(coordinates)) return "the point has no valid coordinates";
  if (type === "LineString" && !isLine(coordinates)) return "the line needs at least 2 valid points";
  if (type === "MultiLineString" && !(Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isLine))) {
    return "every line needs at least 2 valid points";
  }
  if (type === "Polygon") {
    const ring = Array.isArray(coordinates) ? coordinates[0] : null;
    if (!isLine(ring)) return "the polygon has no valid ring";
    const distinct = new Set(ring.map(([lon, lat]) => `${lon},${lat}`));
    if (distinct.size < 3) return "the polygon needs at least 3 points";
  }
  return null;
}

const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;

let collection;
try {
  collection = JSON.parse(readFileSync(FILE, "utf8"));
} catch (error) {
  console.error(`Cannot read ${FILE}: ${error.message}`);
  process.exit(1);
}
if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
  console.error(`${FILE} must be a GeoJSON FeatureCollection`);
  process.exit(1);
}

const errors = [];
const rows = [];
collection.features.forEach((feature, i) => {
  const text = feature?.properties?.address;
  const where = `Feature ${i + 1}${typeof text === "string" ? ` (${text})` : ""}`;
  if (typeof text !== "string" || text.trim() === "") errors.push(`${where}: the address is missing`);
  else if (text.length > MAX_LENGTH) errors.push(`${where}: the address is longer than ${MAX_LENGTH} characters`);
  const problem = geometryError(feature?.geometry);
  if (problem) errors.push(`${where}: ${problem}`);
  if (!problem && typeof text === "string") {
    const { type, coordinates } = feature.geometry;
    rows.push({ text, kind: KINDS[type], geometry: JSON.stringify({ type, coordinates }) });
  }
});
if (errors.length > 0) {
  console.error(`Nothing loaded, fix ${FILE} first:\n${errors.join("\n")}`);
  process.exit(1);
}

const wrangler = (args, options) =>
  spawnSync("npx", ["wrangler", "d1", "execute", "streetbuddy", "--remote", ...args], {
    shell: process.platform === "win32",
    ...options,
  });

// Asks the database whether the file has been loaded before.
const check = wrangler(["--json", `--command=SELECT name FROM walk_files WHERE name = ${quote(NAME)}`], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "inherit"],
});
let loaded;
try {
  loaded = JSON.parse(check.stdout)[0].results.length > 0;
} catch {
  console.error(`Could not check whether ${NAME} was loaded before:\n${check.stdout ?? ""}`);
  process.exit(1);
}
if (loaded) {
  console.error(`${NAME} is already loaded, nothing to do`);
  process.exit(1);
}

// Every statement checks the file name again, so a second run at the same moment adds nothing.
const now = Date.now();
const notLoaded = `NOT EXISTS (SELECT 1 FROM walk_files WHERE name = ${quote(NAME)})`;
const sql = [
  ...rows.map(
    ({ text, kind, geometry }) =>
      `INSERT INTO incoming_addresses (source, text, kind, geometry, created_at)
SELECT 'walk', ${quote(text)}, ${quote(kind)}, ${quote(geometry)}, ${now} WHERE ${notLoaded};`,
  ),
  `INSERT OR IGNORE INTO walk_files (name, loaded_at) VALUES (${quote(NAME)}, ${now});`,
].join("\n");
const sqlFile = join(tmpdir(), `streetbuddy-walk-${now}.sql`);
writeFileSync(sqlFile, `${sql}\n`);

console.log(`${rows.length} addresses in ${FILE}`);
const result = wrangler([`--file=${sqlFile}`], { stdio: "inherit" });
process.exit(result.status ?? 1);
