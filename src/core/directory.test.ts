import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { M_PER_DEG } from "./area";
import {
  addUserAddress,
  approveAllFrom,
  decideIncoming,
  keepFromGroup,
  rejectGroup,
  listDirectory,
  moveIncomingAddresses,
  movePoint,
  nearestAddresses,
  nextIncoming,
  searchPattern,
  setAddressKind,
  setAddressName,
  setIncomingKind,
  setIncomingName,
} from "./directory";
import { shapeBounds, shapeFromGeometry } from "./shapes";
import type { Shape } from "./shapes";

const LAT = 53.405;
const LON = -6.16;
const COS = Math.cos((LAT * Math.PI) / 180);
// [longitude, latitude] of a place x metres east and y metres north.
const at = (x: number, y: number): [number, number] => [LON + x / (M_PER_DEG * COS), LAT + y / M_PER_DEG];
const point = (x: number, y: number) => ({ type: "Point", coordinates: at(x, y) });
const line = (...points: [number, number][]) => ({ type: "LineString", coordinates: points.map(([x, y]) => at(x, y)) });

type Sqlite = ReturnType<typeof fakeD1>["sqlite"];

function addDirectory(sqlite: Sqlite, text: string, geometry: object): number {
  const shape = shapeFromGeometry(geometry) as Shape;
  const { west, south, east, north } = shapeBounds(shape);
  const result = sqlite
    .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(text, shape.kind === "area" ? "area" : shape.kind === "point" ? "house" : "spot", JSON.stringify(geometry), west, south, east, north);
  return Number(result.lastInsertRowid);
}

function addIncoming(
  sqlite: Sqlite,
  text: string,
  geometry: object,
  decision: string | null,
  source = "walk",
): number {
  const form = (shapeFromGeometry(geometry) as Shape).kind;
  const kind = source === "user" ? "temp" : form === "area" ? "area" : form === "point" ? "house" : "spot";
  const result = sqlite
    .prepare(
      `INSERT INTO incoming_addresses (source, text, kind, geometry, user_id, decision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(source, text, kind, JSON.stringify(geometry), source === "user" ? 42 : null, decision);
  return Number(result.lastInsertRowid);
}

const all = (sqlite: Sqlite, sql: string) => sqlite.prepare(sql).all() as Record<string, unknown>[];

describe("nearestAddresses", () => {
  it("gives addresses of any kind within 30 m, nearest first, up to the limit", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "Far", point(31, 0));
    addDirectory(sqlite, "Point", point(0, 20));
    addDirectory(sqlite, "Line", line([-50, 10], [50, 10]));
    addDirectory(sqlite, "Area", {
      type: "Polygon",
      coordinates: [[at(-5, -5), at(5, -5), at(5, 5), at(-5, 5), at(-5, -5)]],
    });
    const [lon, lat] = at(0, 0);
    expect((await nearestAddresses(db, lat, lon, 5)).map((a) => a.text)).toEqual(["Area", "Line", "Point"]);
    expect((await nearestAddresses(db, lat, lon, 2)).map((a) => a.text)).toEqual(["Area", "Line"]);
  });
  it("finds a long line whose ends are far away", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "Street", line([-500, 25], [500, 25]));
    const [lon, lat] = at(0, 0);
    expect((await nearestAddresses(db, lat, lon, 2)).map((a) => a.text)).toEqual(["Street"]);
  });
  it("gives nothing for an empty directory", async () => {
    const { db } = fakeD1();
    expect(await nearestAddresses(db, LAT, LON, 2)).toEqual([]);
  });
});

describe("incoming addresses", () => {
  it("writes an address of a user as a point with the Telegram ID", async () => {
    const { db, sqlite } = fakeD1();
    await addUserAddress(db, 42, "5 New Street", LAT, LON);
    expect(all(sqlite, "SELECT source, text, kind, geometry, user_id, decision FROM incoming_addresses")).toEqual([
      { source: "user", text: "5 New Street", kind: "temp", geometry: JSON.stringify({ type: "Point", coordinates: [LON, LAT] }), user_id: 42, decision: null },
    ]);
  });
  it("shows the queue in order, with the place and the length, and starts again after the last", async () => {
    const { db, sqlite } = fakeD1();
    const a = addIncoming(sqlite, "A", point(0, 0), null);
    addIncoming(sqlite, "Decided", point(0, 0), "approved");
    const b = addIncoming(sqlite, "B", point(0, 0), null, "user");
    expect(await nextIncoming(db, 0)).toMatchObject({ position: 1, total: 2, incoming: [{ id: a, text: "A", source: "walk" }], old: [] });
    expect(await nextIncoming(db, a)).toMatchObject({ position: 2, total: 2, incoming: [{ id: b, text: "B", source: "user" }] });
    expect(await nextIncoming(db, b)).toMatchObject({ incoming: [{ id: a }] });
  });
  it("shows addresses with the same text as one screen at the place of the lowest ID, together with the directory ones", async () => {
    const { db, sqlite } = fakeD1();
    const first = addIncoming(sqlite, "4 Parkside Avenue", point(0, 0), null, "osm");
    const other = addIncoming(sqlite, "B", point(0, 0), null);
    const second = addIncoming(sqlite, " 4 parkside  AVENUE", point(20, 0), null, "osm");
    const old = addDirectory(sqlite, "4 Parkside Avenue", point(60, 0));
    const screen = await nextIncoming(db, 0);
    expect(screen).toMatchObject({ position: 1, total: 2 });
    expect(screen?.incoming.map((address) => address.id)).toEqual([first, second]);
    expect(screen?.old.map((address) => address.id)).toEqual([old]);
    expect(await nextIncoming(db, first)).toMatchObject({ position: 2, total: 2, incoming: [{ id: other }], old: [] });
    expect(await nextIncoming(db, other)).toMatchObject({ position: 1, incoming: [{ id: first }, { id: second }] });
  });
  it("gives null when nothing waits for a decision", async () => {
    const { db } = fakeD1();
    expect(await nextIncoming(db, 0)).toBeNull();
  });
  it("stores the decision once and erases the Telegram ID", async () => {
    const { db, sqlite } = fakeD1();
    const id = addIncoming(sqlite, "A", point(0, 0), null, "user");
    await decideIncoming(db, id, "rejected");
    await decideIncoming(db, id, "approved");
    expect(all(sqlite, "SELECT decision, user_id FROM incoming_addresses")).toEqual([{ decision: "rejected", user_id: null }]);
  });
  it("gives an address of a user the chosen kind, never approves it without one, and keeps the kind of a walk address", async () => {
    const { db, sqlite } = fakeD1();
    const user = addIncoming(sqlite, "User", point(0, 0), null, "user");
    const walk = addIncoming(sqlite, "Walk", point(0, 0), null);
    await decideIncoming(db, user, "approved");
    await decideIncoming(db, user, "replace");
    expect(all(sqlite, "SELECT kind, decision, user_id FROM incoming_addresses WHERE id = " + user)).toEqual([
      { kind: "temp", decision: null, user_id: 42 },
    ]);
    await decideIncoming(db, user, "approved", "appt");
    await decideIncoming(db, walk, "approved", "spot");
    expect(all(sqlite, "SELECT kind, decision, user_id FROM incoming_addresses ORDER BY id")).toEqual([
      { kind: "appt", decision: "approved", user_id: null },
      { kind: "house", decision: "approved", user_id: null },
    ]);
  });
  it("rejects an address of a user without a kind", async () => {
    const { db, sqlite } = fakeD1();
    const user = addIncoming(sqlite, "User", point(0, 0), null, "user");
    await decideIncoming(db, user, "rejected");
    expect(all(sqlite, "SELECT kind, decision FROM incoming_addresses")).toEqual([{ kind: "temp", decision: "rejected" }]);
  });
  it("approves all addresses of one source except those whose text is in the directory and the other sources", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "Duplicate", point(40, 0));
    addIncoming(sqlite, "Walk", point(0, 0), null);
    addIncoming(sqlite, " duplicate", point(0, 0), null, "walk");
    addIncoming(sqlite, "User", point(0, 0), null, "user");
    addIncoming(sqlite, "Osm", point(0, 0), null, "osm");
    await approveAllFrom(db, "walk");
    expect(all(sqlite, "SELECT text, decision FROM incoming_addresses ORDER BY id")).toEqual([
      { text: "Walk", decision: "approved" },
      { text: " duplicate", decision: null },
      { text: "User", decision: null },
      { text: "Osm", decision: null },
    ]);
    await approveAllFrom(db, "osm");
    expect(all(sqlite, "SELECT text, decision FROM incoming_addresses WHERE source = 'osm'")).toEqual([
      { text: "Osm", decision: "approved" },
    ]);
  });
});

describe("keepFromGroup", () => {
  const texts = (sqlite: Sqlite, table: string) => all(sqlite, `SELECT id, decision FROM ${table} ORDER BY id`);
  it("keeping the old address rejects all the new ones and deletes the other old ones", async () => {
    const { db, sqlite } = fakeD1();
    const old1 = addDirectory(sqlite, "4 Parkside Avenue", point(0, 0));
    const old2 = addDirectory(sqlite, "4 Parkside Avenue", point(50, 0));
    const new1 = addIncoming(sqlite, "4 Parkside Avenue", point(10, 0), null, "osm");
    const new2 = addIncoming(sqlite, "4 Parkside Avenue", point(20, 0), null, "osm");
    await keepFromGroup(db, { old: [old1, old2], incoming: [new1, new2] }, { from: "old", id: old2 });
    expect(all(sqlite, "SELECT id FROM addresses")).toEqual([{ id: old2 }]);
    expect(all(sqlite, "SELECT decision FROM incoming_addresses ORDER BY id")).toEqual([
      { decision: "rejected" },
      { decision: "rejected" },
    ]);
  });
  it("keeping a new address replaces the nearest old one, keeping its ID, and removes the rest", async () => {
    const { db, sqlite } = fakeD1();
    const far = addDirectory(sqlite, "4 Parkside Avenue", point(200, 0));
    const near = addDirectory(sqlite, "4 Parkside Avenue", point(30, 0));
    const new1 = addIncoming(sqlite, "4 Parkside Avenue", point(0, 0), null, "osm");
    const new2 = addIncoming(sqlite, "4 Parkside Avenue", point(10, 0), null, "osm");
    await keepFromGroup(db, { old: [far, near], incoming: [new1, new2] }, { from: "incoming", id: new1 });
    expect(all(sqlite, "SELECT id FROM addresses")).toEqual([{ id: near }]);
    expect(texts(sqlite, "incoming_addresses")).toEqual([
      { id: new1, decision: "replace" },
      { id: new2, decision: "rejected" },
    ]);
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT id, geometry FROM addresses")).toEqual([{ id: near, geometry: JSON.stringify(point(0, 0)) }]);
    expect(all(sqlite, "SELECT id FROM incoming_addresses")).toEqual([]);
  });
  it("keeping a new address with no old one approves it", async () => {
    const { db, sqlite } = fakeD1();
    const new1 = addIncoming(sqlite, "4 Parkside Avenue", point(0, 0), null, "osm");
    const new2 = addIncoming(sqlite, "4 Parkside Avenue", point(10, 0), null, "osm");
    await keepFromGroup(db, { old: [], incoming: [new1, new2] }, { from: "incoming", id: new2 });
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, geometry FROM addresses")).toEqual([
      { text: "4 Parkside Avenue", geometry: JSON.stringify(point(10, 0)) },
    ]);
    expect(all(sqlite, "SELECT id FROM incoming_addresses")).toEqual([]);
  });
  it("gives an address of a user the chosen kind, and does nothing for it without a kind", async () => {
    const { db, sqlite } = fakeD1();
    const old = addDirectory(sqlite, "4 Parkside Avenue", point(0, 0));
    const user = addIncoming(sqlite, "4 Parkside Avenue", point(5, 0), null, "user");
    await keepFromGroup(db, { old: [old], incoming: [user] }, { from: "incoming", id: user });
    expect(all(sqlite, "SELECT id FROM addresses")).toEqual([{ id: old }]);
    expect(all(sqlite, "SELECT decision FROM incoming_addresses")).toEqual([{ decision: null }]);
    await keepFromGroup(db, { old: [old], incoming: [user] }, { from: "incoming", id: user }, "facility");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT id, kind, geometry FROM addresses")).toEqual([
      { id: old, kind: "facility", geometry: JSON.stringify(point(5, 0)) },
    ]);
  });
  it("changes nothing for an address that is already decided", async () => {
    const { db, sqlite } = fakeD1();
    const old = addDirectory(sqlite, "4 Parkside Avenue", point(0, 0));
    const decided = addIncoming(sqlite, "4 Parkside Avenue", point(5, 0), "rejected");
    await keepFromGroup(db, { old: [old], incoming: [decided] }, { from: "incoming", id: decided });
    expect(all(sqlite, "SELECT id FROM addresses")).toEqual([{ id: old }]);
  });
});

describe("the directory list and search", () => {
  it("builds a pattern that finds the text anywhere, escapes the wildcards and refuses what D1 would", () => {
    expect(searchPattern("Main")).toBe("%Main%");
    expect(searchPattern("50%_\\")).toBe("%50\\%\\_\\\\%");
    expect(searchPattern("x".repeat(48))).not.toBeNull();
    expect(searchPattern("x".repeat(49))).toBeNull();
    expect(searchPattern("%".repeat(24))).not.toBeNull();
    expect(searchPattern("%".repeat(25))).toBeNull();
  });
  it("lists the directory alphabetically by pages, and moves a page out of range to the nearest", async () => {
    const { db, sqlite } = fakeD1();
    for (const text of ["b 2", "A 1", "c 3", "a 2", "B 1"]) addDirectory(sqlite, text, point(0, 0));
    const first = await listDirectory(db, null, 0, 2);
    expect(first).toMatchObject({ total: 5, page: 0, pages: 3 });
    expect(first.rows.map((row) => row.text)).toEqual(["A 1", "a 2"]);
    expect((await listDirectory(db, null, 2, 2)).rows.map((row) => row.text)).toEqual(["c 3"]);
    expect(await listDirectory(db, null, 9, 2)).toMatchObject({ page: 2, rows: [{ text: "c 3" }] });
    expect(await listDirectory(db, null, -1, 2)).toMatchObject({ page: 0 });
  });
  it("finds the addresses that have the text in them, ignoring case, and treats wildcards as plain characters", async () => {
    const { db, sqlite } = fakeD1();
    for (const text of ["4 Parkside Avenue", "12 Main St", "100% Pizza", "Main_Street"]) addDirectory(sqlite, text, point(0, 0));
    expect((await listDirectory(db, searchPattern("PARKSIDE"), 0, 10)).rows.map((row) => row.text)).toEqual(["4 Parkside Avenue"]);
    expect((await listDirectory(db, searchPattern("%"), 0, 10)).rows.map((row) => row.text)).toEqual(["100% Pizza"]);
    expect((await listDirectory(db, searchPattern("n_s"), 0, 10)).rows.map((row) => row.text)).toEqual(["Main_Street"]);
    expect(await listDirectory(db, searchPattern("nothing"), 0, 10)).toMatchObject({ total: 0, rows: [], page: 0, pages: 1 });
  });
});

describe("approveAllFrom with repeated texts", () => {
  it("leaves addresses whose text another address without a decision has, from any source", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "4 Parkside Avenue", point(0, 0), null, "osm");
    addIncoming(sqlite, "4 parkside avenue", point(20, 0), null, "osm");
    addIncoming(sqlite, "6 Parkside Avenue", point(0, 0), null, "osm");
    addIncoming(sqlite, "Shared", point(0, 0), null, "osm");
    addIncoming(sqlite, "Shared", point(0, 0), null, "walk");
    addIncoming(sqlite, "6 Parkside Avenue", point(0, 0), "rejected", "osm");
    await approveAllFrom(db, "osm");
    expect(all(sqlite, "SELECT text, decision FROM incoming_addresses ORDER BY id")).toEqual([
      { text: "4 Parkside Avenue", decision: null },
      { text: "4 parkside avenue", decision: null },
      { text: "6 Parkside Avenue", decision: "approved" },
      { text: "Shared", decision: null },
      { text: "Shared", decision: null },
      { text: "6 Parkside Avenue", decision: "rejected" },
    ]);
  });
});

describe("approveAllFrom with long runs of spaces", () => {
  it("compares texts with tabs and any number of spaces like the transfer does", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, `4${" ".repeat(30)}Parkside Avenue`, point(0, 0), null, "osm");
    addIncoming(sqlite, "4\tParkside\nAvenue", point(20, 0), null, "osm");
    await approveAllFrom(db, "osm");
    expect(all(sqlite, "SELECT decision FROM incoming_addresses ORDER BY id")).toEqual([{ decision: null }, { decision: null }]);
  });
});

describe("rejectGroup", () => {
  it("rejects every incoming address of the group and leaves the directory alone", async () => {
    const { db, sqlite } = fakeD1();
    const old = addDirectory(sqlite, "4 Parkside Avenue", point(0, 0));
    const first = addIncoming(sqlite, "4 Parkside Avenue", point(1, 0), null, "osm");
    const second = addIncoming(sqlite, "4 parkside avenue", point(2, 0), null, "osm");
    const other = addIncoming(sqlite, "6 Parkside Avenue", point(3, 0), null, "osm");
    await rejectGroup(db, { old: [old], incoming: [first, second] });
    expect(all(sqlite, "SELECT id, decision FROM incoming_addresses ORDER BY id")).toEqual([
      { id: first, decision: "rejected" },
      { id: second, decision: "rejected" },
      { id: other, decision: null },
    ]);
    expect(all(sqlite, "SELECT id FROM addresses")).toEqual([{ id: old }]);
  });
});

describe("the directory IDs", () => {
  it("never gives the ID of a deleted address again", async () => {
    const { db, sqlite } = fakeD1();
    const first = addDirectory(sqlite, "A", point(0, 0));
    sqlite.prepare("DELETE FROM addresses WHERE id = ?").run(first);
    addIncoming(sqlite, "B", point(0, 0), "approved");
    await moveIncomingAddresses(db);
    expect((all(sqlite, "SELECT id FROM addresses")[0].id as number) > first).toBe(true);
  });
});

describe("movePoint", () => {
  it("moves a point and its rectangle, and leaves a line alone", async () => {
    const { db, sqlite } = fakeD1();
    const p = addDirectory(sqlite, "P", point(0, 0));
    const l = addDirectory(sqlite, "L", line([0, 0], [10, 0]));
    await movePoint(db, p, 53.5, -6.2);
    await movePoint(db, l, 53.5, -6.2);
    expect(all(sqlite, "SELECT geometry, west, south, east, north FROM addresses WHERE id = " + p)).toEqual([
      { geometry: JSON.stringify({ type: "Point", coordinates: [-6.2, 53.5] }), west: -6.2, south: 53.5, east: -6.2, north: 53.5 },
    ]);
    expect(all(sqlite, "SELECT geometry FROM addresses WHERE id = " + l)[0].geometry).toBe(JSON.stringify(line([0, 0], [10, 0])));
  });
});

describe("setAddressKind", () => {
  it("changes the kind of an address that is not an area, and leaves an area alone", async () => {
    const { db, sqlite } = fakeD1();
    const house = addDirectory(sqlite, "1 Main Street", point(0, 0));
    const area = addDirectory(sqlite, "Park", {
      type: "Polygon",
      coordinates: [[at(0, 0), at(10, 0), at(10, 10), at(0, 0)]],
    });
    await setAddressKind(db, house, "facility");
    await setAddressKind(db, area, "spot");
    expect(all(sqlite, "SELECT text, kind FROM addresses ORDER BY id")).toEqual([
      { text: "1 Main Street", kind: "facility" },
      { text: "Park", kind: "area" },
    ]);
  });
});

describe("moveIncomingAddresses", () => {
  it("moves an address once when two moves read the same state", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "New", point(0, 0), "approved");
    await Promise.all([moveIncomingAddresses(db), moveIncomingAddresses(db)]);
    expect(all(sqlite, "SELECT text FROM addresses")).toEqual([{ text: "New" }]);
    expect(all(sqlite, "SELECT id FROM incoming_addresses")).toEqual([]);
  });
  it("replaces an address once when two moves read the same state", async () => {
    const { db, sqlite } = fakeD1();
    const old = addDirectory(sqlite, "Street", point(40, 0));
    addIncoming(sqlite, "Street", point(0, 0), "replace");
    await Promise.all([moveIncomingAddresses(db), moveIncomingAddresses(db)]);
    expect(all(sqlite, "SELECT id, text FROM addresses")).toEqual([{ id: old, text: "Street" }]);
  });
  it("keeps the kind of the incoming address and leaves an approved one without a kind in the queue", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "Shop", point(0, 0), "approved");
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'facility'").run();
    const noKind = addIncoming(sqlite, "No kind", point(20, 0), "approved", "user");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, kind FROM addresses")).toEqual([{ text: "Shop", kind: "facility" }]);
    expect(all(sqlite, "SELECT id, decision FROM incoming_addresses")).toEqual([{ id: noKind, decision: "approved" }]);
  });
  it("moves approved addresses into the directory with their rectangle, drops rejected ones, keeps the rest", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "Street", line([0, 0], [10, 20]), "approved");
    addIncoming(sqlite, "Rejected", point(0, 0), "rejected");
    addIncoming(sqlite, "Waiting", point(0, 0), null);
    await moveIncomingAddresses(db);
    const [west, south] = at(0, 0);
    const [east, north] = at(10, 20);
    expect(all(sqlite, "SELECT text, kind, west, south, east, north FROM addresses")).toEqual([
      { text: "Street", kind: "spot", west, south, east, north },
    ]);
    expect(all(sqlite, "SELECT text FROM incoming_addresses")).toEqual([{ text: "Waiting" }]);
  });
  it("moves an address with its source, and a replacement puts its source in place of the old one", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "From the walk", point(0, 0), "approved");
    addIncoming(sqlite, "From OSM", point(100, 0), "approved", "osm");
    addIncoming(sqlite, "Written", point(200, 0), "approved", "user");
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'house'").run();
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, source FROM addresses ORDER BY id")).toEqual([
      { text: "From the walk", source: "walk" },
      { text: "From OSM", source: "osm" },
      { text: "Written", source: "user" },
    ]);
    addIncoming(sqlite, "From OSM", point(130, 0), "replace", "walk");
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'house'").run();
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, source FROM addresses WHERE text = 'From OSM'")).toEqual([{ text: "From OSM", source: "walk" }]);
  });
  it("drops an address with the same text closer than 5 m, ignoring case and spaces", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main Street", point(0, 0));
    addIncoming(sqlite, " 1  main street", point(4, 0), "approved");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text FROM addresses")).toEqual([{ text: "1 Main Street" }]);
    expect(all(sqlite, "SELECT id FROM incoming_addresses")).toEqual([]);
  });
  it("counts a shape inside a territory with the same text as 0 m away", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "Square", { type: "Polygon", coordinates: [[at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(0, 0)]] });
    addIncoming(sqlite, "Square", point(50, 50), "approved");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT id FROM incoming_addresses")).toEqual([]);
    expect(all(sqlite, "SELECT id FROM addresses")).toHaveLength(1);
  });
  it("leaves an address with the same text farther away without a decision", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main Street", point(0, 0));
    addIncoming(sqlite, "1 Main Street", point(40, 0), "approved");
    addIncoming(sqlite, "2 Main Street", point(1, 0), "approved");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, decision FROM incoming_addresses")).toEqual([{ text: "1 Main Street", decision: null }]);
    expect(all(sqlite, "SELECT text FROM addresses ORDER BY id")).toEqual([{ text: "1 Main Street" }, { text: "2 Main Street" }]);
  });
  it("checks addresses moved in the same night against each other", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "A", point(0, 0), "approved");
    addIncoming(sqlite, "A", point(2, 0), "approved");
    addIncoming(sqlite, "A", point(50, 0), "approved");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text FROM addresses")).toEqual([{ text: "A" }]);
    expect(all(sqlite, "SELECT decision FROM incoming_addresses")).toEqual([{ decision: null }]);
  });
  it("puts a replacement in place of the nearest directory address with the same text, keeping its ID", async () => {
    const { db, sqlite } = fakeD1();
    const near = addDirectory(sqlite, "1 Main Street", point(0, 0));
    const far = addDirectory(sqlite, "1 main street", point(300, 0));
    addIncoming(sqlite, "1 Main Street", point(60, 0), "replace");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT id, text, geometry FROM addresses ORDER BY id")).toEqual([
      { id: near, text: "1 Main Street", geometry: JSON.stringify(point(60, 0)) },
      { id: far, text: "1 main street", geometry: JSON.stringify(point(300, 0)) },
    ]);
    expect(all(sqlite, "SELECT id FROM incoming_addresses")).toEqual([]);
  });
  it("adds a replacement as new when the old address is gone", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "1 Main Street", point(60, 0), "replace");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text FROM addresses")).toEqual([{ text: "1 Main Street" }]);
  });
  it("does nothing when nothing is decided", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "A", point(0, 0), null);
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text FROM incoming_addresses")).toEqual([{ text: "A" }]);
  });
});

describe("the name of a facility", () => {
  it("is set and erased only for a facility", async () => {
    const { db, sqlite } = fakeD1();
    const shop = addDirectory(sqlite, "19 Parkside Row", point(0, 0));
    const house = addDirectory(sqlite, "1 Main Street", point(50, 0));
    await setAddressKind(db, shop, "facility");
    await setAddressName(db, shop, "Little Rainbows");
    await setAddressName(db, house, "Not a facility");
    expect(all(sqlite, "SELECT text, name FROM addresses ORDER BY id")).toEqual([
      { text: "19 Parkside Row", name: "Little Rainbows" },
      { text: "1 Main Street", name: null },
    ]);
    await setAddressName(db, shop, null);
    expect(all(sqlite, "SELECT name FROM addresses WHERE id = " + shop)).toEqual([{ name: null }]);
  });

  it("is erased when the kind changes to another one, and kept for facility", async () => {
    const { db, sqlite } = fakeD1();
    const shop = addDirectory(sqlite, "19 Parkside Row", point(0, 0));
    await setAddressKind(db, shop, "facility");
    await setAddressName(db, shop, "Little Rainbows");
    await setAddressKind(db, shop, "facility");
    expect(all(sqlite, "SELECT name FROM addresses")).toEqual([{ name: "Little Rainbows" }]);
    await setAddressKind(db, shop, "house");
    expect(all(sqlite, "SELECT name FROM addresses")).toEqual([{ name: null }]);
  });

  it("is set on an incoming facility without a decision, and erased when its kind changes", async () => {
    const { db, sqlite } = fakeD1();
    const open = addIncoming(sqlite, "19 Parkside Row", point(0, 0), null);
    const decided = addIncoming(sqlite, "21 Parkside Row", point(50, 0), "approved");
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'facility'").run();
    await setIncomingName(db, open, "Little Rainbows");
    await setIncomingName(db, decided, "Decided");
    expect(all(sqlite, "SELECT id, name FROM incoming_addresses ORDER BY id")).toEqual([
      { id: open, name: "Little Rainbows" },
      { id: decided, name: null },
    ]);
    await setIncomingKind(db, open, "spot");
    expect(all(sqlite, "SELECT name FROM incoming_addresses WHERE id = " + open)).toEqual([{ name: null }]);
  });

  it("is found by the search of the directory, together with the address", async () => {
    const { db, sqlite } = fakeD1();
    const shop = addDirectory(sqlite, "19 Parkside Row", point(0, 0));
    addDirectory(sqlite, "Rainbow Road", point(50, 0));
    await setAddressKind(db, shop, "facility");
    await setAddressName(db, shop, "Little Rainbows");
    const found = await listDirectory(db, searchPattern("rainbow"), 0, 10);
    expect(found.rows.map((row) => row.text)).toEqual(["19 Parkside Row", "Rainbow Road"]);
    expect(found.total).toBe(2);
  });

  it("moves into the directory with the address, and a replacement puts its name in place of the old one", async () => {
    const { db, sqlite } = fakeD1();
    const first = addIncoming(sqlite, "19 Parkside Row", point(0, 0), "approved");
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'facility', name = 'Little Rainbows' WHERE id = ?").run(first);
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, name FROM addresses")).toEqual([{ text: "19 Parkside Row", name: "Little Rainbows" }]);
    const second = addIncoming(sqlite, "19 Parkside Row", point(30, 0), "replace");
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'facility', name = 'Rainbows Creche' WHERE id = ?").run(second);
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, name FROM addresses")).toEqual([{ text: "19 Parkside Row", name: "Rainbows Creche" }]);
  });
});
