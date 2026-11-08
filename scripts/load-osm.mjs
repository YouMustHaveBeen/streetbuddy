// Loads an OpenStreetMap (Overpass JSON) file of the objects with a house number into the incoming
// addresses of the D1 database streetbuddy, with the source osm and without a decision. Only the
// objects inside the district that have a street are loaded. A file is loaded once: its name is kept
// in walk_files, and a file with a name already there is refused. If any object is wrong, nothing is loaded.
// Run from the project folder: node scripts/load-osm.mjs ~/YouMustHaveBeen/osm-district.json
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const FILE = process.argv[2];
if (!FILE) {
  console.error("Name the OSM file, for example: node scripts/load-osm.mjs ~/YouMustHaveBeen/osm-district.json");
  process.exit(1);
}
const NAME = basename(FILE);
const MAX_LENGTH = 100;

const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;

let elements;
try {
  elements = JSON.parse(readFileSync(FILE, "utf8")).elements;
} catch (error) {
  console.error(`Cannot read ${FILE}: ${error.message}`);
  process.exit(1);
}
if (!Array.isArray(elements)) {
  console.error("The file has no elements list: is it an Overpass JSON answer?");
  process.exit(1);
}

const area = JSON.parse(readFileSync(new URL("../config/area.geojson", import.meta.url), "utf8"));
const ring = area.features[0].geometry.coordinates[0];

// True when the point is inside the ring (ray casting).
function inside(lon, lat) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}

// The kind of the address: a childcare is a facility, apartments are an appt, anything else is a house.
function kindOf(tags) {
  if (tags.amenity === "childcare") return "facility";
  if (tags.building === "apartments") return "appt";
  return "house";
}

const errors = [];
const rows = [];
let outside = 0;
let withoutStreet = 0;
for (const element of elements) {
  const where = `${element.type} ${element.id}`;
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    errors.push(`${where}: no coordinates, ask Overpass for \`out tags center;\``);
    continue;
  }
  if (!inside(lon, lat)) {
    outside++;
    continue;
  }
  const tags = element.tags ?? {};
  const number = String(tags["addr:housenumber"] ?? "").trim();
  const street = String(tags["addr:street"] ?? "").trim();
  if (number === "") {
    errors.push(`${where}: the house number is missing`);
    continue;
  }
  if (street === "") {
    withoutStreet++;
    continue;
  }
  const text = `${number} ${street}`.replace(/\bStreet\b/g, "St").replace(/\s+/g, " ");
  if (text.length > MAX_LENGTH) {
    errors.push(`${where} (${text}): the address is longer than ${MAX_LENGTH} characters`);
    continue;
  }
  rows.push({ text, kind: kindOf(tags), geometry: JSON.stringify({ type: "Point", coordinates: [lon, lat] }) });
}
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

// Every statement checks the file name again, so a second run at the same moment adds nothing,
// and skips a row of this file that is already there, so a run cut off midway can be repeated.
const now = Date.now();
const notLoaded = `NOT EXISTS (SELECT 1 FROM walk_files WHERE name = ${quote(NAME)})`;
const sql = [
  ...rows.map(
    ({ text, kind, geometry }) =>
      `INSERT INTO incoming_addresses (source, text, kind, geometry, walk_file, created_at)
SELECT 'osm', ${quote(text)}, ${quote(kind)}, ${quote(geometry)}, ${quote(NAME)}, ${now} WHERE ${notLoaded}
AND NOT EXISTS (SELECT 1 FROM incoming_addresses WHERE walk_file = ${quote(NAME)} AND text = ${quote(text)} AND geometry = ${quote(geometry)});`,
  ),
  `INSERT OR IGNORE INTO walk_files (name, loaded_at) VALUES (${quote(NAME)}, ${now});`,
].join("\n");
const sqlFile = join(tmpdir(), `streetbuddy-osm-${now}.sql`);
writeFileSync(sqlFile, `${sql}\n`);

console.log(`${rows.length} addresses to load from ${FILE} (outside the district: ${outside}, without a street, skipped: ${withoutStreet})`);
const result = wrangler([`--file=${sqlFile}`], { stdio: "inherit" });
process.exit(result.status ?? 1);
