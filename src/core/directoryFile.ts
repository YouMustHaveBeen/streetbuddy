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
  kind: AddressKind;
  geometry: Geometry;
}

export type ImportResult =
  | { ok: false; reason: "not_geojson" }
  | { ok: false; reason: "errors"; errors: string[] }
  | { ok: false; reason: "gone" }
  | { ok: true; loaded: number; unchanged: number };

// The whole directory as a FeatureCollection; every feature has address, kind and source.
export async function exportDirectory(db: D1Database): Promise<string> {
  const { results } = await db
    .prepare("SELECT text, kind, source, geometry FROM addresses WHERE geometry != '' ORDER BY id")
    .all<{ text: string; kind: string; source: string; geometry: string }>();
  const features = results.map(({ text, kind, source, geometry }) => ({
    type: "Feature",
    properties: { address: text, kind, source },
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

// The reason the kind is wrong for the geometry, or null.
function kindError(kind: unknown, geometryType: string): string | null {
  if (typeof kind !== "string" || kind === "") return "the kind is missing";
  if (kind === "temp") return "the kind temp is not allowed in the file";
  if (!KINDS.includes(kind)) return `the kind must be ${KINDS.join(", ")}, not ${kind}`;
  if (kind === "area" && geometryType !== "Polygon") return "the kind area needs a Polygon";
  if (kind !== "area" && geometryType === "Polygon") return "a Polygon needs the kind area";
  return null;
}

// Coordinates are compared rounded to 6 digits.
const round = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(round) : typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value;
const sameTextKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const keyOf = (text: string, kind: string, geometry: Geometry) =>
  JSON.stringify([text.trim(), kind, geometry.type, round(geometry.coordinates)]);

// Reads the file: null when it is not a GeoJSON FeatureCollection, otherwise its addresses or the
// errors of its features.
function readFile(content: string): { addresses: FileAddress[]; errors: string[] } | null {
  let collection: { type?: unknown; features?: unknown };
  try {
    collection = JSON.parse(content);
  } catch {
    return null;
  }
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) return null;
  const errors: string[] = [];
  const addresses: FileAddress[] = [];
  collection.features.forEach((feature: { properties?: Record<string, unknown>; geometry?: unknown }, i: number) => {
    const text = feature?.properties?.address;
    const where = `Feature ${i + 1}${typeof text === "string" ? ` (${text})` : ""}`;
    if (typeof text !== "string" || text.trim() === "") errors.push(`${where}: the address is missing`);
    else if (text.length > MAX_LENGTH) errors.push(`${where}: the address is longer than ${MAX_LENGTH} characters`);
    const problem = geometryError(feature?.geometry);
    if (problem) errors.push(`${where}: ${problem}`);
    const kind = feature?.properties?.kind;
    const { type, coordinates } = (feature?.geometry ?? {}) as Geometry;
    const kindProblem = problem ? null : kindError(kind, type);
    if (kindProblem) errors.push(`${where}: ${kindProblem}`);
    if (!problem && !kindProblem && typeof text === "string") {
      addresses.push({ text: text.trim(), kind: kind as AddressKind, geometry: { type, coordinates } });
    }
  });
  return { addresses, errors };
}

// Puts the new and changed addresses of the file into the incoming addresses: an address with the same
// text, kind and shape as one in the directory or one without a decision is skipped, and so is a repeat
// inside the file. Nothing is loaded when a feature is wrong, or when the text of a new or changed
// address is in the directory more than once or belongs to two new or changed features of the file.
// claim runs after every check and before the first write; when it returns false nothing is written.
// Two reads in one batch, and one batch of inserts; loaded counts the rows actually inserted.
export async function importDirectoryFile(
  db: D1Database,
  content: string,
  claim: () => Promise<boolean>,
): Promise<ImportResult> {
  const file = readFile(content);
  if (!file) return { ok: false, reason: "not_geojson" };
  if (file.errors.length > 0) return { ok: false, reason: "errors", errors: file.errors };

  const [directory, waiting] = await db.batch([
    db.prepare("SELECT text, kind, geometry FROM addresses"),
    db.prepare("SELECT text, kind, geometry FROM incoming_addresses WHERE decision IS NULL"),
  ]);
  const known = new Set<string>();
  const textCounts = new Map<string, number>();
  for (const row of directory.results as { text: string; kind: string; geometry: string }[]) {
    known.add(keyOf(row.text, row.kind, JSON.parse(row.geometry)));
    textCounts.set(sameTextKey(row.text), (textCounts.get(sameTextKey(row.text)) ?? 0) + 1);
  }
  for (const row of waiting.results as { text: string; kind: string; geometry: string }[]) {
    known.add(keyOf(row.text, row.kind, JSON.parse(row.geometry)));
  }

  const changed: FileAddress[] = [];
  const changedByText = new Map<string, { text: string; count: number }>();
  const errors: string[] = [];
  let unchanged = 0;
  for (const address of file.addresses) {
    const key = keyOf(address.text, address.kind, address.geometry);
    if (known.has(key)) {
      unchanged += 1;
      continue;
    }
    known.add(key);
    const count = textCounts.get(sameTextKey(address.text)) ?? 0;
    if (count > 1) errors.push(`"${address.text}" is in the directory ${count} times: fix it in Edit directory`);
    const seen = changedByText.get(sameTextKey(address.text));
    changedByText.set(sameTextKey(address.text), { text: seen?.text ?? address.text, count: (seen?.count ?? 0) + 1 });
    changed.push(address);
  }
  for (const { text, count } of changedByText.values()) {
    if (count > 1) errors.push(`"${text}" is in the file ${count} times as new or changed: leave one of them`);
  }
  if (errors.length > 0) return { ok: false, reason: "errors", errors };
  if (!(await claim())) return { ok: false, reason: "gone" };

  const now = Date.now();
  const inserts: D1PreparedStatement[] = [];
  for (let start = 0; start < changed.length; start += INSERT_CHUNK) {
    const rows = changed
      .slice(start, start + INSERT_CHUNK)
      .map(({ text, kind, geometry }) => ({ text, kind, geometry: JSON.stringify(geometry) }));
    // A row the same as an incoming address without a decision is skipped.
    inserts.push(
      db
        .prepare(
          `INSERT INTO incoming_addresses (source, text, kind, geometry, created_at)
           SELECT 'walk', json_extract(value, '$.text'), json_extract(value, '$.kind'), json_extract(value, '$.geometry'), ?2
           FROM json_each(?1) AS row
           WHERE NOT EXISTS (
             SELECT 1 FROM incoming_addresses i
             WHERE i.decision IS NULL AND i.text = json_extract(row.value, '$.text')
               AND i.kind = json_extract(row.value, '$.kind') AND i.geometry = json_extract(row.value, '$.geometry')
           )`,
        )
        .bind(JSON.stringify(rows), now),
    );
  }
  const written = inserts.length > 0 ? await db.batch(inserts) : [];
  const loaded = written.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  return { ok: true, loaded, unchanged };
}
