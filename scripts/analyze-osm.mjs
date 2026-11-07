// Reads an OpenStreetMap (Overpass) JSON file of the objects with a house number and prints what is in it.
// It only reads: nothing is loaded anywhere.
// Usage: node scripts/analyze-osm.mjs <file.json>
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/analyze-osm.mjs <file.json>");
  process.exit(1);
}

let elements;
try {
  elements = JSON.parse(readFileSync(file, "utf8")).elements;
} catch (error) {
  console.error(`Cannot read ${file}: ${error.message}`);
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

// The tag that says what the object is, or "only address" when it has none.
const KIND_TAGS = ["shop", "amenity", "office", "tourism", "leisure", "healthcare", "craft", "building"];
function whatItIs(tags) {
  for (const key of KIND_TAGS) {
    if (tags[key]) return `${key}=${tags[key]}`;
  }
  return "only address";
}

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const byType = new Map();
const byKind = new Map();
const noStreet = [];
let total = 0;
let withStreet = 0;
let withName = 0;
let outside = 0;
let withoutCoordinates = 0;

for (const element of elements) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat === undefined || lon === undefined) {
    withoutCoordinates++;
    continue;
  }
  if (!inside(lon, lat)) {
    outside++;
    continue;
  }
  const tags = element.tags ?? {};
  total++;
  count(byType, element.type);
  count(byKind, whatItIs(tags));
  if (tags["addr:street"]) withStreet++;
  else noStreet.push(`${tags["addr:housenumber"] ?? "?"} ${tags["addr:housename"] ?? tags.name ?? ""} (${element.type} ${element.id})`.trim());
  if (tags.name) withName++;
}

const lines = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([key, n]) => `  ${key}: ${n}`);
console.log(`Inside the district: ${total} (outside it: ${outside})`);
if (withoutCoordinates > 0) {
  console.log(`NOT analyzed, no coordinates: ${withoutCoordinates}. Ask Overpass for \`out tags center;\` so every object has a point.`);
}
console.log(`With a street: ${withStreet}, without a street: ${total - withStreet}, with a name: ${withName}`);
console.log("By OSM type:");
console.log(lines(byType).join("\n"));
console.log("By what the object is:");
console.log(lines(byKind).join("\n"));
if (noStreet.length > 0) {
  console.log("Without a street (first 20):");
  console.log(noStreet.slice(0, 20).map((entry) => `  ${entry}`).join("\n"));
}
