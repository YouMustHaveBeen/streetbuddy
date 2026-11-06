import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { M_PER_DEG } from "./area";
import {
  addUserAddress,
  sameTextDistance,
  approveAllWalk,
  decideIncoming,
  moveIncomingAddresses,
  movePoint,
  nearestAddresses,
  nextIncoming,
  setAddressKind,
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
    expect(await nextIncoming(db, 0)).toMatchObject({ id: a, text: "A", position: 1, total: 2, source: "walk" });
    expect(await nextIncoming(db, a)).toMatchObject({ id: b, text: "B", position: 2, total: 2, source: "user" });
    expect(await nextIncoming(db, b)).toMatchObject({ id: a });
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
  it("approves all walk addresses except those whose text is in the directory and addresses of users", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "Duplicate", point(40, 0));
    addIncoming(sqlite, "Walk", point(0, 0), null);
    addIncoming(sqlite, " duplicate", point(0, 0), null, "walk");
    addIncoming(sqlite, "User", point(0, 0), null, "user");
    await approveAllWalk(db);
    expect(all(sqlite, "SELECT text, decision FROM incoming_addresses ORDER BY id")).toEqual([
      { text: "Walk", decision: "approved" },
      { text: " duplicate", decision: null },
      { text: "User", decision: null },
    ]);
  });
});

describe("sameTextDistance", () => {
  it("gives the distance to the nearest directory address with the same text, ignoring case and spaces", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main Street", point(100, 0));
    addDirectory(sqlite, "1  main street", point(30, 0));
    addDirectory(sqlite, "2 Main Street", point(1, 0));
    expect(await sameTextDistance(db, " 1 Main  Street", JSON.stringify(point(0, 0)))).toBeCloseTo(30, 1);
    expect(await sameTextDistance(db, "3 Main Street", JSON.stringify(point(0, 0)))).toBeNull();
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
