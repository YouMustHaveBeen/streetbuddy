// The address directory as a GeoJSON file: the export to edit it on geojson.io, and the file sent back,
// whose new and changed addresses go into the incoming addresses without a decision, with the source walk.
import type { AddressKind } from "./directory";

const MAX_LENGTH = 100;
const GEOMETRY_TYPES = ["Point", "LineString", "MultiLineString", "Polygon"];
const KINDS = ["house", "appt", "facility", "spot", "area"];
// How many addresses one insert statement takes.
const INSERT_CHUNK = 100;

interface Geometry {
  type: string;
  coordinates: unknown;
}

interface FileAddress {
  text: string;
  // The name of a facility, null when there is none.
  name: string | null;
  kind: AddressKind;
  geometry: Geometry;
}

export type ImportResult =
  | { ok: false; reason: "not_geojson" }
  | { ok: false; reason: "gone" }
  | { ok: true; loaded: number; unchanged: number; skipped: string[] };

// The whole directory as a FeatureCollection; every feature has address, kind and source, and a
// facility with a name has name.
export async function exportDirectory(db: D1Database): Promise<string> {
  const { results } = await db
    .prepare("SELECT text, name, kind, source, geometry FROM addresses WHERE geometry != '' ORDER BY id")
    .all<{ text: string; name: string | null; kind: string; source: string; geometry: string }>();
  const features = results.map(({ text, name, kind, source, geometry }) => ({
    type: "Feature",
    properties: { address: text, kind, source, ...(name ? { name } : {}) },
    geometry: JSON.parse(geometry),
  }));
  return `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`;
}

const isPosition = (p: unknown): p is number[] =>
  Array.isArray(p) &&
  p.length >= 2 &&
  p.every((value) => Number.isFinite(value)) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;
const isLine = (l: unknown): l is number[][] => Array.isArray(l) && l.length >= 2 && l.every(isPosition);

// The reason a geometry is wrong, or null.
function geometryError(geometry: unknown): string | null {
  const { type, coordinates } = (geometry ?? {}) as { type?: unknown; coordinates?: unknown };
  if (typeof type !== "string" || !GEOMETRY_TYPES.includes(type)) {
    return `geometry must be Point, LineString, MultiLineString or Polygon, not ${String(type)}`;
  }
  if (type === "Point" && !isPosition(coordinates)) return "the point has no valid coordinates";
  if (type === "LineString" && !isLine(coordinates)) return "the line needs at least 2 valid points";
  if (type === "MultiLineString" && !(Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isLine))) {
    return "every line needs at least 2 valid points";
  }
  if (type === "Polygon") {
    if (Array.isArray(coordinates) && coordinates.length > 1) return "the polygon must have one ring";
    const ring = Array.isArray(coordinates) ? coordinates[0] : null;
    if (!isLine(ring) || ring.length < 4) return "the polygon has no valid ring";
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1]) return "the polygon ring is not closed";
    const distinct = new Set(ring.map(([lon, lat]) => `${lon},${lat}`));
    if (distinct.size < 3) return "the polygon needs at least 3 points";
  }
  return null;
}

// The kind of a feature without one: house for a point, spot for a line, area for a polygon.
function defaultKind(geometryType: string): AddressKind {
  if (geometryType === "Point") return "house";
  if (geometryType === "Polygon") return "area";
  return "spot";
}

// The reason the kind is wrong for the geometry, or null. A missing kind is not wrong.
function kindError(kind: unknown, geometryType: string): string | null {
  if (kind === undefined || kind === null || kind === "") return null;
  if (typeof kind !== "string") return `the kind must be ${KINDS.join(", ")}`;
  if (kind === "temp") return "the kind temp is not allowed in the file";
  if (!KINDS.includes(kind)) return `the kind must be ${KINDS.join(", ")}, not ${kind}`;
  if (kind === "area" && geometryType !== "Polygon") return "the kind area needs a Polygon";
  if (kind !== "area" && geometryType === "Polygon") return "a Polygon needs the kind area";
  return null;
}

// Coordinates are compared rounded to 6 digits.
const round = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(round) : typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value;
const keyOf = (text: string, name: string | null, kind: string, geometry: Geometry) =>
  JSON.stringify([text.trim(), name ?? "", kind, geometry.type, round(geometry.coordinates)]);

// Reads the file: null when it is not a GeoJSON FeatureCollection, otherwise its addresses and, for every
// feature that is wrong, one line with its number and the first reason; such a feature is skipped.
function readFile(content: string): { addresses: FileAddress[]; skipped: string[] } | null {
  let collection: { type?: unknown; features?: unknown };
  try {
    collection = JSON.parse(content);
  } catch {
    return null;
  }
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) return null;
  const skipped: string[] = [];
  const addresses: FileAddress[] = [];
  collection.features.forEach((feature: { properties?: Record<string, unknown>; geometry?: unknown }, i: number) => {
    const text = feature?.properties?.address;
    const textProblem =
      typeof text !== "string" || text.trim() === ""
        ? "the address is missing"
        : text.length > MAX_LENGTH
          ? `the address is longer than ${MAX_LENGTH} characters`
          : null;
    const geometryProblem = geometryError(feature?.geometry);
    const { type, coordinates } = (feature?.geometry ?? {}) as Geometry;
    const rawKind = feature?.properties?.kind;
    const kindProblem = geometryProblem ? null : kindError(rawKind, type);
    const problem = textProblem ?? geometryProblem ?? kindProblem;
    if (problem !== null) {
      skipped.push(`Object ${i + 1}: ${problem}`);
      return;
    }
    const kind = typeof rawKind === "string" && rawKind !== "" ? (rawKind as AddressKind) : defaultKind(type);
    // The name counts only for a facility; for any other kind it is ignored.
    const rawName = feature?.properties?.name;
    const name = kind === "facility" && typeof rawName === "string" && rawName.trim() !== "" ? rawName.trim() : null;
    if (name !== null && name.length > MAX_LENGTH) {
      skipped.push(`Object ${i + 1}: the name is longer than ${MAX_LENGTH} characters`);
      return;
    }
    addresses.push({ text: (text as string).trim(), name, kind, geometry: { type, coordinates } });
  });
  return { addresses, skipped };
}

// Puts the new and changed addresses of the file into the incoming addresses: an address with the same
// text, kind and shape as one in the directory or one without a decision is skipped, and so is a repeat
// inside the file. A wrong feature is skipped and listed in skipped; the others are loaded.
// claim runs after every check and before the first write; when it returns false nothing is written.
// Two reads in one batch, and one batch of inserts; loaded counts the rows actually inserted.
export async function importDirectoryFile(
  db: D1Database,
  content: string,
  claim: () => Promise<boolean>,
): Promise<ImportResult> {
  const file = readFile(content);
  if (!file) return { ok: false, reason: "not_geojson" };

  const [directory, waiting] = await db.batch([
    db.prepare("SELECT text, name, kind, geometry FROM addresses"),
    db.prepare("SELECT text, name, kind, geometry FROM incoming_addresses WHERE decision IS NULL"),
  ]);
  const known = new Set<string>();
  for (const row of directory.results as { text: string; name: string | null; kind: string; geometry: string }[]) {
    known.add(keyOf(row.text, row.name, row.kind, JSON.parse(row.geometry)));
  }
  for (const row of waiting.results as { text: string; name: string | null; kind: string; geometry: string }[]) {
    known.add(keyOf(row.text, row.name, row.kind, JSON.parse(row.geometry)));
  }

  const changed: FileAddress[] = [];
  let unchanged = 0;
  for (const address of file.addresses) {
    const key = keyOf(address.text, address.name, address.kind, address.geometry);
    if (known.has(key)) {
      unchanged += 1;
      continue;
    }
    known.add(key);
    changed.push(address);
  }
  if (!(await claim())) return { ok: false, reason: "gone" };

  const now = Date.now();
  const inserts: D1PreparedStatement[] = [];
  for (let start = 0; start < changed.length; start += INSERT_CHUNK) {
    const rows = changed
      .slice(start, start + INSERT_CHUNK)
      .map(({ text, name, kind, geometry }) => ({ text, name, kind, geometry: JSON.stringify(geometry) }));
    // A row the same as an incoming address without a decision is skipped.
    inserts.push(
      db
        .prepare(
          `INSERT INTO incoming_addresses (source, text, name, kind, geometry, created_at)
           SELECT 'walk', json_extract(value, '$.text'), json_extract(value, '$.name'), json_extract(value, '$.kind'), json_extract(value, '$.geometry'), ?2
           FROM json_each(?1) AS row
           WHERE NOT EXISTS (
             SELECT 1 FROM incoming_addresses i
             WHERE i.decision IS NULL AND i.text = json_extract(row.value, '$.text')
               AND i.name IS json_extract(row.value, '$.name')
               AND i.kind = json_extract(row.value, '$.kind') AND i.geometry = json_extract(row.value, '$.geometry')
           )`,
        )
        .bind(JSON.stringify(rows), now),
    );
  }
  const written = inserts.length > 0 ? await db.batch(inserts) : [];
  const loaded = written.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  return { ok: true, loaded, unchanged, skipped: file.skipped };
}
