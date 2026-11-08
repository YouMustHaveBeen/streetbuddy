// One-time script. If the OSM file has several objects with the same address text (same house number and
// street), none of them should be in the directory without a decision. This script finds the directory
// addresses (source osm) that come from such groups, shows the list, and after the answer y moves each of
// them back to the incoming addresses without a decision (it adds the incoming row, then deletes the
// directory row, only while both are as listed). The addresses of the walks are not touched.
// Run from the project folder: node scripts/return-osm-duplicates.mjs ~/YouMustHaveBeen/osm-district.json
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";

const FILE = process.argv[2];
if (!FILE) {
  console.error("Name the OSM file, for example: node scripts/return-osm-duplicates.mjs ~/YouMustHaveBeen/osm-district.json");
  process.exit(1);
}
const NAME = basename(FILE);
const SAME_PLACE_M = 2;

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const textKey = (text) => String(text).trim().toLowerCase().replace(/\s+/g, " ");
const metres = ([lon1, lat1], [lon2, lat2]) =>
  Math.hypot((lon1 - lon2) * 111320 * Math.cos((53.4 * Math.PI) / 180), (lat1 - lat2) * 110540);

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
function inside(lon, lat) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}

// The same objects and the same text as scripts/load-osm.mjs.
const groups = new Map();
for (const element of elements) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const tags = element.tags ?? {};
  const number = String(tags["addr:housenumber"] ?? "").trim();
  const street = String(tags["addr:street"] ?? "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || number === "" || street === "" || !inside(lon, lat)) continue;
  const key = textKey(`${number} ${street}`.replace(/\bStreet\b/g, "St"));
  groups.set(key, [...(groups.get(key) ?? []), [lon, lat]]);
}
const repeated = new Map([...groups].filter(([, places]) => places.length > 1));
console.log(`${repeated.size} address texts of the OSM file belong to several objects.`);

function wrangler(args, options) {
  return spawnSync("npx", ["wrangler", "d1", "execute", "streetbuddy", "--remote", ...args], {
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}
function query(sql) {
  const result = wrangler(["--json", `--command=${sql}`], { stdio: ["inherit", "pipe", "inherit"] });
  try {
    return JSON.parse(result.stdout)[0].results;
  } catch {
    console.error(`The database did not answer:\n${result.stdout ?? ""}`);
    process.exit(1);
  }
}

const rows = query("SELECT id, text, kind, geometry FROM addresses WHERE source = 'osm' ORDER BY id").filter((row) =>
  repeated.has(textKey(row.text)),
);
const plan = [];
for (const row of rows) {
  const geometry = JSON.parse(row.geometry);
  const places = repeated.get(textKey(row.text));
  const fits = geometry.type === "Point" && places.some((place) => metres(geometry.coordinates, place) <= SAME_PLACE_M);
  if (fits) plan.push(row);
  else console.log(`Skipped "${row.text}" (id ${row.id}): its place is not one of the OSM objects, it was changed after the load.`);
}
if (plan.length === 0) {
  console.log("Nothing to move back.");
  process.exit(0);
}
console.log(`\n${plan.length} directory addresses will go back to the incoming addresses:`);
for (const row of plan) console.log(`#${row.id} "${row.text}" (${repeated.get(textKey(row.text)).length} objects in OSM)`);

const input = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await input.question("\nMove them back? (y/n) ")).trim().toLowerCase();
input.close();
if (answer !== "y") {
  console.log("Nothing changed.");
  process.exit(0);
}

const now = Date.now();
const sql = plan
  .flatMap((row) => {
    const same = `text = ${quote(row.text)} AND geometry = ${quote(row.geometry)}`;
    return [
      `INSERT INTO incoming_addresses (source, text, kind, geometry, walk_file, created_at)
SELECT 'osm', ${quote(row.text)}, ${quote(row.kind)}, ${quote(row.geometry)}, ${quote(NAME)}, ${now}
WHERE EXISTS (SELECT 1 FROM addresses WHERE id = ${Number(row.id)} AND source = 'osm' AND ${same});`,
      `DELETE FROM addresses WHERE id = ${Number(row.id)} AND source = 'osm' AND ${same}
AND EXISTS (SELECT 1 FROM incoming_addresses WHERE source = 'osm' AND decision IS NULL AND ${same});`,
    ];
  })
  .join("\n");
const sqlFile = join(mkdtempSync(join(tmpdir(), "streetbuddy-")), "return-osm.sql");
writeFileSync(sqlFile, `${sql}\n`);
wrangler([`--file=${sqlFile}`], { stdio: "inherit" });

// Checks every address again.
const left = query("SELECT id FROM addresses WHERE source = 'osm'").map((row) => row.id);
const notMoved = plan.filter((row) => left.includes(row.id));
if (notMoved.length > 0) {
  console.error(`${notMoved.length} of ${plan.length} addresses were NOT moved:\n${notMoved.map((row) => `"${row.text}"`).join("\n")}`);
  process.exit(1);
}
console.log(`${plan.length} addresses moved back and checked. Open /admin, Incoming addresses.`);
