import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { M_PER_DEG } from "./area";
import {
  addUserAddress,
  approveAllWalk,
  decideIncoming,
  moveIncomingAddresses,
  movePoint,
  nearestAddresses,
  nextIncoming,
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
    .run(text, shape.kind, JSON.stringify(geometry), west, south, east, north);
  return Number(result.lastInsertRowid);
}

function addIncoming(
  sqlite: Sqlite,
  text: string,
  geometry: object,
  decision: string | null,
  source = "walk",
  duplicateM: number | null = null,
): number {
  const kind = (shapeFromGeometry(geometry) as Shape).kind;
  const result = sqlite
    .prepare(
      `INSERT INTO incoming_addresses (source, text, kind, geometry, user_id, decision, duplicate_m, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(source, text, kind, JSON.stringify(geometry), source === "user" ? 42 : null, decision, duplicateM);
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
      { source: "user", text: "5 New Street", kind: "point", geometry: JSON.stringify({ type: "Point", coordinates: [LON, LAT] }), user_id: 42, decision: null },
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
  it("approves all walk addresses except possible duplicates and addresses of users", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "Walk", point(0, 0), null);
    addIncoming(sqlite, "Duplicate", point(0, 0), null, "walk", 12);
    addIncoming(sqlite, "User", point(0, 0), null, "user");
    await approveAllWalk(db);
    expect(all(sqlite, "SELECT text, decision FROM incoming_addresses ORDER BY id")).toEqual([
      { text: "Walk", decision: "approved" },
      { text: "Duplicate", decision: null },
      { text: "User", decision: null },
    ]);
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

describe("moveIncomingAddresses", () => {
  it("moves approved addresses into the directory with their rectangle, drops rejected ones, keeps the rest", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "Street", line([0, 0], [10, 20]), "approved");
    addIncoming(sqlite, "Rejected", point(0, 0), "rejected");
    addIncoming(sqlite, "Waiting", point(0, 0), null);
    await moveIncomingAddresses(db);
    const [west, south] = at(0, 0);
    const [east, north] = at(10, 20);
    expect(all(sqlite, "SELECT text, kind, west, south, east, north FROM addresses")).toEqual([
      { text: "Street", kind: "line", west, south, east, north },
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
  it("marks an address with the same text farther away as a possible duplicate and leaves it without a decision", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main Street", point(0, 0));
    addIncoming(sqlite, "1 Main Street", point(40, 0), "approved");
    addIncoming(sqlite, "2 Main Street", point(1, 0), "approved");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text, decision, duplicate_m FROM incoming_addresses")).toEqual([
      { text: "1 Main Street", decision: null, duplicate_m: 40 },
    ]);
    expect(all(sqlite, "SELECT text FROM addresses ORDER BY id")).toEqual([{ text: "1 Main Street" }, { text: "2 Main Street" }]);
  });
  it("checks addresses moved in the same night against each other", async () => {
    const { db, sqlite } = fakeD1();
    addIncoming(sqlite, "A", point(0, 0), "approved");
    addIncoming(sqlite, "A", point(2, 0), "approved");
    addIncoming(sqlite, "A", point(50, 0), "approved");
    await moveIncomingAddresses(db);
    expect(all(sqlite, "SELECT text FROM addresses")).toEqual([{ text: "A" }]);
    expect(all(sqlite, "SELECT duplicate_m FROM incoming_addresses")).toEqual([{ duplicate_m: 50 }]);
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
