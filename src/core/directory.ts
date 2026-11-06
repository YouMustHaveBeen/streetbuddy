// The address directory and the incoming addresses in D1.
import { M_PER_DEG } from "./area";
import { distanceBetween, distanceToShape, pointGeometry, shapeBounds, shapeFromGeometry } from "./shapes";
import type { Shape } from "./shapes";
import { TWO_MONTHS_MS } from "./shared";

// Directory addresses farther than this from the point are not offered.
const ADDRESS_RADIUS_M = 30;
// An approved address with the same text this close to a directory address is a duplicate.
const DUPLICATE_M = 5;
// How long an address written by a user waits for a decision.
export const USER_ADDRESS_TTL_MS = TWO_MONTHS_MS;

// The kinds an administrator can give an address; a polygon is always an area.
export const CHOOSABLE_KINDS = ["house", "appt", "facility", "spot"] as const;
export type AddressKind = (typeof CHOOSABLE_KINDS)[number] | "area";

interface DirectoryAddress {
  id: number;
  text: string;
  kind: AddressKind;
  geometry: string;
}

interface IncomingAddress {
  id: number;
  source: "walk" | "user";
  text: string;
  kind: AddressKind | "temp";
  geometry: string;
  position: number;
  total: number;
}

export type Decision = "approved" | "rejected" | "replace";

const parseShape = (geometry: string): Shape | null => shapeFromGeometry(JSON.parse(geometry));

// Case and extra spaces do not count when texts are compared.
const sameTextKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
// The same comparison in SQL, for a column or a parameter.
const sqlTextKey = (expression: string) =>
  `lower(trim(replace(replace(replace(${expression}, '    ', ' '), '  ', ' '), '  ', ' ')))`;

// Up to `limit` directory addresses of any kind within ADDRESS_RADIUS_M of the point, nearest first.
// Only the rows whose rectangle comes within the radius are read.
export async function nearestAddresses(
  db: D1Database,
  lat: number,
  lon: number,
  limit: number,
): Promise<DirectoryAddress[]> {
  const dLat = ADDRESS_RADIUS_M / M_PER_DEG;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const { results } = await db
    .prepare(
      `SELECT id, text, kind, geometry FROM addresses
       WHERE west <= ?1 AND east >= ?2 AND south <= ?3 AND north >= ?4`,
    )
    .bind(lon + dLon, lon - dLon, lat + dLat, lat - dLat)
    .all<DirectoryAddress>();
  return results
    .map((row) => {
      const shape = parseShape(row.geometry);
      return { row, distance: shape ? distanceToShape(shape, lat, lon) : Infinity };
    })
    .filter((found) => found.distance <= ADDRESS_RADIUS_M)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((found) => found.row);
}

// An address written by a user, as the point of the report's location.
export async function addUserAddress(
  db: D1Database,
  userId: number,
  text: string,
  lat: number,
  lon: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO incoming_addresses (source, text, kind, geometry, user_id, created_at)
       VALUES ('user', ?1, 'temp', ?2, ?3, ?4)`,
    )
    .bind(text, JSON.stringify(pointGeometry(lat, lon)), userId, Date.now())
    .run();
}

// The next incoming address without a decision after afterId, or the first one when there is
// none after it, with its place in the queue and the length of the queue.
export async function nextIncoming(db: D1Database, afterId: number): Promise<IncomingAddress | null> {
  return db
    .prepare(
      `SELECT i.id, i.source, i.text, i.kind, i.geometry,
         (SELECT count(*) FROM incoming_addresses WHERE decision IS NULL AND id <= i.id) AS position,
         (SELECT count(*) FROM incoming_addresses WHERE decision IS NULL) AS total
       FROM incoming_addresses i WHERE i.decision IS NULL
       ORDER BY i.id <= ?1, i.id LIMIT 1`,
    )
    .bind(afterId)
    .first<IncomingAddress>();
}

// The decision also erases the author's Telegram ID. An address with the kind temp takes the chosen
// kind; without a kind it cannot be approved.
export async function decideIncoming(
  db: D1Database,
  id: number,
  decision: Decision,
  kind: AddressKind | null = null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE incoming_addresses
       SET decision = ?2, user_id = NULL, kind = CASE WHEN kind = 'temp' AND ?3 IS NOT NULL THEN ?3 ELSE kind END
       WHERE id = ?1 AND decision IS NULL AND (?2 = 'rejected' OR kind != 'temp' OR ?3 IS NOT NULL)`,
    )
    .bind(id, decision, kind)
    .run();
}

// Metres from the shape to the nearest directory address with the same text, or null when there
// is none.
export async function sameTextDistance(db: D1Database, text: string, geometry: string): Promise<number | null> {
  const shape = parseShape(geometry);
  if (!shape) return null;
  const { results } = await db
    .prepare(`SELECT geometry FROM addresses WHERE ${sqlTextKey("text")} = ${sqlTextKey("?1")}`)
    .bind(text)
    .all<{ geometry: string }>();
  const distances = results
    .map((row) => parseShape(row.geometry))
    .filter((other): other is Shape => other !== null)
    .map((other) => distanceBetween(shape, other));
  return distances.length > 0 ? Math.min(...distances) : null;
}

// Approves every walk address without a decision, except those whose text is already in the directory.
export async function approveAllWalk(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE incoming_addresses SET decision = 'approved'
       WHERE source = 'walk' AND decision IS NULL
         AND NOT EXISTS (SELECT 1 FROM addresses a WHERE ${sqlTextKey("a.text")} = ${sqlTextKey("incoming_addresses.text")})`,
    )
    .run();
}

export async function getAddress(db: D1Database, id: number): Promise<DirectoryAddress | null> {
  return db.prepare("SELECT id, text, kind, geometry FROM addresses WHERE id = ?1").bind(id).first<DirectoryAddress>();
}

export async function renameAddress(db: D1Database, id: number, text: string): Promise<void> {
  await db.prepare("UPDATE addresses SET text = ?2 WHERE id = ?1").bind(id, text).run();
}

// The kind of an address that is not an area.
export async function setAddressKind(
  db: D1Database,
  id: number,
  kind: (typeof CHOOSABLE_KINDS)[number],
): Promise<void> {
  await db.prepare("UPDATE addresses SET kind = ?2 WHERE id = ?1 AND kind != 'area'").bind(id, kind).run();
}

// Only a point can be moved.
export async function movePoint(db: D1Database, id: number, lat: number, lon: number): Promise<void> {
  await db
    .prepare(
      `UPDATE addresses SET geometry = ?2, west = ?3, south = ?4, east = ?3, north = ?4
       WHERE id = ?1 AND json_extract(geometry, '$.type') = 'Point'`,
    )
    .bind(id, JSON.stringify(pointGeometry(lat, lon)), lon, lat)
    .run();
}

export async function deleteAddress(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM addresses WHERE id = ?1").bind(id).run();
}

interface Known {
  id: number | null;
  key: string;
  shape: Shape;
}

// The nightly move: approved addresses go into the directory, unless a directory address with the
// same text is within DUPLICATE_M (then the incoming one is dropped) or farther away (then it stays
// without a decision, and its screen offers Keep old and Replace old); "replace" puts the new shape and text in
// place of the nearest directory address with the same text; rejected addresses are dropped.
// Two reads and one batch of writes.
export async function moveIncomingAddresses(db: D1Database): Promise<void> {
  const [decided, directory] = await db.batch([
    db.prepare("SELECT id, text, kind, geometry, decision FROM incoming_addresses WHERE decision IS NOT NULL ORDER BY id"),
    db.prepare("SELECT id, text, geometry FROM addresses"),
  ]);
  const known: Known[] = [];
  for (const row of directory.results as { id: number; text: string; geometry: string }[]) {
    const shape = parseShape(row.geometry);
    if (shape) known.push({ id: row.id, key: sameTextKey(row.text), shape });
  }

  const writes: D1PreparedStatement[] = [];
  const drop = (id: number) => db.prepare("DELETE FROM incoming_addresses WHERE id = ?1").bind(id);
  const insert = (text: string, kind: AddressKind, geometry: string, shape: Shape) => {
    const { west, south, east, north } = shapeBounds(shape);
    return db
      .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(text, kind, geometry, west, south, east, north);
  };

  for (const row of decided.results as { id: number; text: string; kind: AddressKind | "temp"; geometry: string; decision: Decision }[]) {
    if (row.decision === "rejected") {
      writes.push(drop(row.id));
      continue;
    }
    const shape = parseShape(row.geometry);
    if (!shape || row.kind === "temp") {
      console.error(`Incoming address ${row.id} has a broken shape or no kind`);
      continue;
    }
    const key = sameTextKey(row.text);
    const nearest = known
      .filter((entry) => entry.key === key && (row.decision === "approved" || entry.id !== null))
      .map((entry) => ({ entry, distance: distanceBetween(shape, entry.shape) }))
      .sort((a, b) => a.distance - b.distance)[0];

    if (row.decision === "replace" && nearest) {
      const { west, south, east, north } = shapeBounds(shape);
      writes.push(
        db
          .prepare(
            "UPDATE addresses SET text = ?2, kind = ?3, geometry = ?4, west = ?5, south = ?6, east = ?7, north = ?8 WHERE id = ?1",
          )
          .bind(nearest.entry.id, row.text, row.kind, row.geometry, west, south, east, north),
        drop(row.id),
      );
      nearest.entry.shape = shape;
    } else if (row.decision === "approved" && nearest && nearest.distance <= DUPLICATE_M) {
      writes.push(drop(row.id));
    } else if (row.decision === "approved" && nearest) {
      writes.push(db.prepare("UPDATE incoming_addresses SET decision = NULL WHERE id = ?1").bind(row.id));
    } else {
      writes.push(insert(row.text, row.kind, row.geometry, shape), drop(row.id));
      known.push({ id: null, key, shape });
    }
  }
  if (writes.length > 0) await db.batch(writes);
}
