// The address directory and the incoming addresses in D1.
import { M_PER_DEG } from "./area";
import { distanceBetween, distanceToShape, pointGeometry, shapeBounds, shapeFromGeometry } from "./shapes";
import type { Shape } from "./shapes";
import { pageIn, TWO_MONTHS_MS } from "./shared";

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

// A directory address with its name (only a facility has one).
interface NamedAddress extends DirectoryAddress {
  name: string | null;
}

interface IncomingAddress {
  id: number;
  source: "walk" | "user" | "osm";
  text: string;
  name: string | null;
  kind: AddressKind | "temp";
  geometry: string;
}

// What the incoming screen shows: the addresses without a decision that have the same text (the
// lowest ID first), the directory addresses with that text, and the place of the screen in the queue.
// Two or more addresses in all make a group of duplicates.
export interface IncomingScreen {
  position: number;
  total: number;
  incoming: IncomingAddress[];
  old: NamedAddress[];
}

// The IDs of the addresses a group of duplicates had on screen, and the one that stays.
export interface DuplicateGroup {
  old: number[];
  incoming: number[];
}
export interface Keep {
  from: "old" | "incoming";
  id: number;
}

export type Decision = "approved" | "rejected" | "replace";

const parseShape = (geometry: string): Shape | null => shapeFromGeometry(JSON.parse(geometry));

// Case and extra spaces do not count when texts are compared.
const sameTextKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
// The same comparison in SQL, for a column or a parameter: tabs and line breaks become spaces, then
// every run of spaces up to the 100 characters of an address is halved seven times down to one space.
// lower() folds only the letters of ASCII.
const sqlTextKey = (expression: string) => {
  const spaced = `replace(replace(replace(${expression}, char(9), ' '), char(10), ' '), char(13), ' ')`;
  let squeezed = spaced;
  for (let pass = 0; pass < 7; pass++) squeezed = `replace(${squeezed}, '  ', ' ')`;
  return `lower(trim(${squeezed}))`;
};

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

// An address written by a user, as the point of the report's location; its kind is temp unless the user chose one.
export async function addUserAddress(
  db: D1Database,
  userId: number,
  text: string,
  lat: number,
  lon: number,
  kind: (typeof CHOOSABLE_KINDS)[number] | "temp" = "temp",
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO incoming_addresses (source, text, kind, geometry, user_id, created_at)
       VALUES ('user', ?1, ?5, ?2, ?3, ?4)`,
    )
    .bind(text, JSON.stringify(pointGeometry(lat, lon)), userId, Date.now(), kind)
    .run();
}

// The next screen of the incoming addresses after afterId (the ID of the first address of the
// previous screen), or the first one when there is none after it. Addresses without a decision that
// have the same text are one screen, shown at the place of the lowest ID. With groupOf, the screen is
// the one of the address with that ID, or the next one when the address has no screen.
export async function nextIncoming(
  db: D1Database,
  afterId: number,
  groupOf: number | null = null,
): Promise<IncomingScreen | null> {
  const { results } = await db
    .prepare("SELECT id, source, text, name, kind, geometry FROM incoming_addresses WHERE decision IS NULL ORDER BY id")
    .all<IncomingAddress>();
  const groups = new Map<string, IncomingAddress[]>();
  for (const row of results) {
    const key = sameTextKey(row.text);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const screens = [...groups.values()];
  if (screens.length === 0) return null;
  const after =
    groupOf === null ? afterId : (screens.find((group) => group.some((row) => row.id === groupOf))?.[0].id ?? groupOf) - 1;
  const index = Math.max(0, screens.findIndex((group) => group[0].id > after));
  const incoming = screens[index];
  const old = await db
    .prepare(`SELECT id, text, name, kind, geometry FROM addresses WHERE ${sqlTextKey("text")} = ${sqlTextKey("?1")} ORDER BY id`)
    .bind(incoming[0].text)
    .all<NamedAddress>();
  return { position: index + 1, total: screens.length, incoming, old: old.results };
}

const decideStatement = (db: D1Database, id: number, decision: Decision, kind: AddressKind | null) =>
  db
    .prepare(
      `UPDATE incoming_addresses
       SET decision = ?2, user_id = NULL, kind = CASE WHEN kind = 'temp' AND ?3 IS NOT NULL THEN ?3 ELSE kind END
       WHERE id = ?1 AND decision IS NULL AND (?2 = 'rejected' OR kind != 'temp' OR ?3 IS NOT NULL)`,
    )
    .bind(id, decision, kind);

// The decision also erases the author's Telegram ID. An address with the kind temp takes the chosen
// kind; without a kind it cannot be approved.
export async function decideIncoming(
  db: D1Database,
  id: number,
  decision: Decision,
  kind: AddressKind | null = null,
): Promise<void> {
  await decideStatement(db, id, decision, kind).run();
}

// A group of duplicates is decided by keeping one of its addresses: the other incoming addresses
// are rejected and the other directory addresses are deleted. A kept incoming address takes the
// place of the nearest directory address of the group (which keeps its ID), or is approved when the
// group has none. The caller moves the decided addresses into the directory afterwards.
export async function keepFromGroup(
  db: D1Database,
  group: DuplicateGroup,
  keep: Keep,
  kind: AddressKind | null = null,
): Promise<void> {
  const list = (ids: number[]) => JSON.stringify(ids);
  const rejectOthers = (exceptId: number) =>
    db
      .prepare(
        `UPDATE incoming_addresses SET decision = 'rejected', user_id = NULL
         WHERE decision IS NULL AND id IN (SELECT value FROM json_each(?1)) AND id != ?2`,
      )
      .bind(list(group.incoming), exceptId);
  const deleteOld = (exceptId: number | null) =>
    db
      .prepare("DELETE FROM addresses WHERE id IN (SELECT value FROM json_each(?1)) AND id IS NOT ?2")
      .bind(list(group.old), exceptId);

  if (keep.from === "old") {
    await db.batch([rejectOthers(0), deleteOld(keep.id)]);
    return;
  }
  const [oldRows, keptRow] = await db.batch([
    db.prepare("SELECT id, geometry FROM addresses WHERE id IN (SELECT value FROM json_each(?1))").bind(list(group.old)),
    db.prepare("SELECT geometry, kind FROM incoming_addresses WHERE id = ?1 AND decision IS NULL").bind(keep.id),
  ]);
  const kept = keptRow.results[0] as { geometry: string; kind: string } | undefined;
  // Nothing is decided for an address that is gone or still needs its kind.
  if (!kept || (kept.kind === "temp" && kind === null)) return;
  const shape = parseShape(kept.geometry);
  const nearest = shape
    ? (oldRows.results as { id: number; geometry: string }[])
        .flatMap((row) => {
          const other = parseShape(row.geometry);
          return other ? [{ id: row.id, distance: distanceBetween(shape, other) }] : [];
        })
        .sort((a, b) => a.distance - b.distance)[0]
    : undefined;
  await db.batch([
    rejectOthers(keep.id),
    deleteOld(nearest?.id ?? null),
    decideStatement(db, keep.id, nearest ? "replace" : "approved", kind),
  ]);
}

// Rejects every incoming address of a group, the directory addresses of the group stay. The caller
// drops the rejected addresses afterwards.
export async function rejectGroup(db: D1Database, group: DuplicateGroup): Promise<void> {
  await db
    .prepare(
      `UPDATE incoming_addresses SET decision = 'rejected', user_id = NULL
       WHERE decision IS NULL AND id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(group.incoming))
    .run();
}

// Approves every address of the source without a decision, except those whose text is already in the
// directory and those whose text another address without a decision has: such duplicates are decided
// one by one.
export async function approveAllFrom(db: D1Database, source: "walk" | "osm"): Promise<void> {
  await db
    .prepare(
      `WITH repeated AS (
         SELECT ${sqlTextKey("text")} AS key FROM incoming_addresses WHERE decision IS NULL
         GROUP BY key HAVING count(*) > 1
       )
       UPDATE incoming_addresses SET decision = 'approved'
       WHERE source = ?1 AND decision IS NULL
         AND NOT EXISTS (SELECT 1 FROM addresses a WHERE ${sqlTextKey("a.text")} = ${sqlTextKey("incoming_addresses.text")})
         AND ${sqlTextKey("incoming_addresses.text")} NOT IN (SELECT key FROM repeated)`,
    )
    .bind(source)
    .run();
}

// D1 refuses a LIKE pattern longer than this many bytes.
const SEARCH_PATTERN_MAX_BYTES = 50;

// The LIKE pattern that finds the text anywhere in an address; null when D1 would refuse it.
export function searchPattern(text: string): string | null {
  const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  return new TextEncoder().encode(pattern).length <= SEARCH_PATTERN_MAX_BYTES ? pattern : null;
}

// One page of the directory by text, alphabetically; a null pattern lists everything. A page out of
// range becomes the nearest one.
export async function listDirectory(
  db: D1Database,
  pattern: string | null,
  page: number,
  perPage: number,
): Promise<{ rows: { id: number; text: string }[]; total: number; page: number; pages: number }> {
  const where = "WHERE ?1 IS NULL OR text LIKE ?1 ESCAPE '\\' OR name LIKE ?1 ESCAPE '\\'";
  const rows = (wanted: number) =>
    db
      .prepare(`SELECT id, text FROM addresses ${where} ORDER BY lower(text), id LIMIT ?2 OFFSET ?3`)
      .bind(pattern, perPage, wanted * perPage);
  const wanted = Math.max(0, Math.floor(page));
  const [counted, found] = await db.batch([
    db.prepare(`SELECT count(*) AS n FROM addresses ${where}`).bind(pattern),
    rows(wanted),
  ]);
  const total = (counted.results[0] as { n: number }).n;
  const { page: last, pages } = pageIn(wanted, total, perPage);
  const results = last === wanted ? found.results : (await rows(last).all()).results;
  return { rows: results as { id: number; text: string }[], total, page: last, pages };
}

export async function getAddress(db: D1Database, id: number): Promise<NamedAddress | null> {
  return db.prepare("SELECT id, text, name, kind, geometry FROM addresses WHERE id = ?1").bind(id).first<NamedAddress>();
}

export async function renameAddress(db: D1Database, id: number, text: string): Promise<void> {
  await db.prepare("UPDATE addresses SET text = ?2 WHERE id = ?1").bind(id, text).run();
}

// The text of an incoming address that has no decision yet.
export async function renameIncoming(db: D1Database, id: number, text: string): Promise<void> {
  await db.prepare("UPDATE incoming_addresses SET text = ?2 WHERE id = ?1 AND decision IS NULL").bind(id, text).run();
}

// The kind of an incoming address that has no decision yet and is not an area; the name is erased
// unless the kind is facility.
export async function setIncomingKind(
  db: D1Database,
  id: number,
  kind: (typeof CHOOSABLE_KINDS)[number],
): Promise<void> {
  await db
    .prepare(
      `UPDATE incoming_addresses SET kind = ?2, name = CASE WHEN ?2 = 'facility' THEN name ELSE NULL END
       WHERE id = ?1 AND decision IS NULL AND kind != 'area'`,
    )
    .bind(id, kind)
    .run();
}

// The kind of an address that is not an area; the name is erased unless the kind is facility.
export async function setAddressKind(
  db: D1Database,
  id: number,
  kind: (typeof CHOOSABLE_KINDS)[number],
): Promise<void> {
  await db
    .prepare(
      "UPDATE addresses SET kind = ?2, name = CASE WHEN ?2 = 'facility' THEN name ELSE NULL END WHERE id = ?1 AND kind != 'area'",
    )
    .bind(id, kind)
    .run();
}

// The name of a facility; null erases it.
export async function setAddressName(db: D1Database, id: number, name: string | null): Promise<void> {
  await db.prepare("UPDATE addresses SET name = ?2 WHERE id = ?1 AND kind = 'facility'").bind(id, name).run();
}

// The name of an incoming facility that has no decision yet; null erases it.
export async function setIncomingName(db: D1Database, id: number, name: string | null): Promise<void> {
  await db
    .prepare("UPDATE incoming_addresses SET name = ?2 WHERE id = ?1 AND decision IS NULL AND kind = 'facility'")
    .bind(id, name)
    .run();
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
// without a decision, and its screen shows it with the directory address as a group of duplicates); "replace" puts the new shape and text in
// place of the nearest directory address with the same text; rejected addresses are dropped.
// Two reads and one batch of writes.
export async function moveIncomingAddresses(db: D1Database): Promise<void> {
  const [decided, directory] = await db.batch([
    db.prepare("SELECT id, source, text, name, kind, geometry, decision FROM incoming_addresses WHERE decision IS NOT NULL ORDER BY id"),
    db.prepare("SELECT id, text, geometry FROM addresses"),
  ]);
  const known: Known[] = [];
  for (const row of directory.results as { id: number; text: string; geometry: string }[]) {
    const shape = parseShape(row.geometry);
    if (shape) known.push({ id: row.id, key: sameTextKey(row.text), shape });
  }

  const writes: D1PreparedStatement[] = [];
  const drop = (id: number) => db.prepare("DELETE FROM incoming_addresses WHERE id = ?1").bind(id);
  // The writes run only while the incoming row is still there, so of two moves that read the same
  // state only the first one changes the directory.
  const insert = (
    id: number,
    source: string,
    text: string,
    name: string | null,
    kind: AddressKind,
    geometry: string,
    shape: Shape,
  ) => {
    const { west, south, east, north } = shapeBounds(shape);
    return db
      .prepare(
        `INSERT INTO addresses (text, kind, geometry, west, south, east, north, source, name)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?9, ?10 WHERE EXISTS (SELECT 1 FROM incoming_addresses WHERE id = ?8)`,
      )
      .bind(text, kind, geometry, west, south, east, north, id, source, name);
  };

  for (const row of decided.results as {
    id: number;
    source: string;
    text: string;
    name: string | null;
    kind: AddressKind | "temp";
    geometry: string;
    decision: Decision;
  }[]) {
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
            `UPDATE addresses SET text = ?2, kind = ?3, geometry = ?4, west = ?5, south = ?6, east = ?7, north = ?8, source = ?10, name = ?11
             WHERE id = ?1 AND EXISTS (SELECT 1 FROM incoming_addresses WHERE id = ?9)`,
          )
          .bind(nearest.entry.id, row.text, row.kind, row.geometry, west, south, east, north, row.id, row.source, row.name),
        drop(row.id),
      );
      nearest.entry.shape = shape;
    } else if (row.decision === "approved" && nearest && nearest.distance <= DUPLICATE_M) {
      writes.push(drop(row.id));
    } else if (row.decision === "approved" && nearest) {
      writes.push(db.prepare("UPDATE incoming_addresses SET decision = NULL WHERE id = ?1 AND decision = 'approved'").bind(row.id));
    } else {
      writes.push(insert(row.id, row.source, row.text, row.name, row.kind, row.geometry, shape), drop(row.id));
      known.push({ id: null, key, shape });
    }
  }
  if (writes.length > 0) await db.batch(writes);
}
