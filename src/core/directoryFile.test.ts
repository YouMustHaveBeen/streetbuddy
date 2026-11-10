import { describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { exportDirectory, importDirectoryFile } from "./directoryFile";

type Sqlite = ReturnType<typeof fakeD1>["sqlite"];

const load = (db: D1Database, content: string) => importDirectoryFile(db, content, async () => true);

const point = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });
const feature = (address: unknown, kind: unknown, geometry: unknown, source?: string) => ({
  type: "Feature",
  properties: source === undefined ? { address, kind } : { address, kind, source },
  geometry,
});
const file = (...features: unknown[]) => JSON.stringify({ type: "FeatureCollection", features });

function addDirectory(sqlite: Sqlite, text: string, kind: string, geometry: object, source = "walk") {
  sqlite
    .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north, source) VALUES (?, ?, ?, 0, 0, 0, 0, ?)")
    .run(text, kind, JSON.stringify(geometry), source);
}
const incoming = (sqlite: Sqlite) =>
  sqlite.prepare("SELECT source, text, kind, geometry, decision FROM incoming_addresses ORDER BY id").all();

describe("exportDirectory", () => {
  it("writes every directory address with its text, kind and source", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main St", "house", point(-6.16, 53.405), "osm");
    const exported = JSON.parse(await exportDirectory(db));
    expect(exported).toEqual({
      type: "FeatureCollection",
      features: [feature("1 Main St", "house", point(-6.16, 53.405), "osm")],
    });
  });
});

describe("importDirectoryFile", () => {
  it("loads only new and changed addresses as walk addresses, and skips the unchanged ones", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main St", "house", point(-6.16, 53.405), "osm");
    addDirectory(sqlite, "2 Main St", "house", point(-6.1601, 53.405));
    const result = await load(db,
      file(
        feature("1 Main St", "house", point(-6.160000001, 53.405), "osm"),
        feature("2 Main St", "house", point(-6.1602, 53.405), "walk"),
        feature("3 Main St", "facility", point(-6.1603, 53.405)),
        feature("3 Main St", "facility", point(-6.1603, 53.405)),
      ),
    );
    expect(result).toEqual({ ok: true, loaded: 2, unchanged: 2, skipped: [] });
    expect(incoming(sqlite)).toEqual([
      { source: "walk", text: "2 Main St", kind: "house", geometry: JSON.stringify(point(-6.1602, 53.405)), decision: null },
      { source: "walk", text: "3 Main St", kind: "facility", geometry: JSON.stringify(point(-6.1603, 53.405)), decision: null },
    ]);
  });

  it("loads a changed OSM address with the source walk", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main St", "house", point(-6.16, 53.405), "osm");
    await load(db, file(feature("1 Main St", "appt", point(-6.16, 53.405), "osm")));
    expect(incoming(sqlite)).toEqual([expect.objectContaining({ source: "walk", kind: "appt" })]);
  });

  it("adds nothing when the same file is sent again", async () => {
    const { db, sqlite } = fakeD1();
    const sent = file(feature("3 Main St", "house", point(-6.1603, 53.405)));
    await load(db, sent);
    expect(await load(db, sent)).toEqual({ ok: true, loaded: 0, unchanged: 1, skipped: [] });
    expect(incoming(sqlite)).toHaveLength(1);
  });

  it("does not insert an address twice when two loads read the same state, and counts only what was inserted", async () => {
    const { db, sqlite } = fakeD1();
    const sent = file(feature("3 Main St", "house", point(-6.1603, 53.405)));
    const results = await Promise.all([load(db, sent), load(db, sent)]);
    expect(incoming(sqlite)).toHaveLength(1);
    expect(results.map((result) => (result.ok ? result.loaded : null)).sort()).toEqual([0, 1]);
  });

  it("loads a line of several parts and an area", async () => {
    const { db, sqlite } = fakeD1();
    const lines = { type: "MultiLineString", coordinates: [[[-6.16, 53.405], [-6.159, 53.405]], [[-6.159, 53.405], [-6.159, 53.406]]] };
    const area = { type: "Polygon", coordinates: [[[-6.16, 53.405], [-6.159, 53.405], [-6.159, 53.406], [-6.16, 53.405]]] };
    expect(await load(db, file(feature("Main St", "spot", lines), feature("Green", "area", area)))).toEqual({
      ok: true,
      loaded: 2,
      unchanged: 0,
      skipped: [],
    });
    expect(incoming(sqlite).map((row: any) => [row.text, row.kind, row.geometry])).toEqual([
      ["Main St", "spot", JSON.stringify(lines)],
      ["Green", "area", JSON.stringify(area)],
    ]);
  });

  it("writes nothing when the claim fails, and claims only after every check", async () => {
    const { db, sqlite } = fakeD1();
    const claim = vi.fn(async () => false);
    expect(await importDirectoryFile(db, file(feature("3 Main St", "house", point(-6.1603, 53.405))), claim)).toEqual({
      ok: false,
      reason: "gone",
    });
    expect(incoming(sqlite)).toEqual([]);
    await importDirectoryFile(db, file(feature("", "house", point(-6.1603, 53.405))), claim);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("says when the file is not a GeoJSON FeatureCollection", async () => {
    const { db } = fakeD1();
    expect(await load(db, "not json")).toEqual({ ok: false, reason: "not_geojson" });
    expect(await load(db, JSON.stringify({ type: "Feature" }))).toEqual({ ok: false, reason: "not_geojson" });
  });

  it("skips the wrong features, lists them and loads the others", async () => {
    const { db, sqlite } = fakeD1();
    const ring = [[-6.16, 53.405], [-6.159, 53.405], [-6.159, 53.406], [-6.16, 53.405]];
    const result = await load(db,
      file(
        feature("Fine", "house", point(-6.16, 53.405)),
        feature("", "house", point(-6.16, 53.405)),
        feature("x".repeat(101), "house", point(-6.16, 53.405)),
        feature("Temp", "temp", point(-6.16, 53.405)),
        feature("Odd kind", "shop", point(-6.16, 53.405)),
        feature("Area point", "area", point(-6.16, 53.405)),
        feature("Polygon house", "house", { type: "Polygon", coordinates: [ring] }),
        feature("Open", "area", { type: "Polygon", coordinates: [ring.slice(0, 3)] }),
        feature("Far", "house", point(-6.16, 95)),
        feature("Short line", "spot", { type: "LineString", coordinates: [[-6.16, 53.405]] }),
        feature("Holes", "area", { type: "Polygon", coordinates: [ring, ring] }),
        feature("Extra value", "house", { type: "Point", coordinates: [-6.16, 53.405, "x"] }),
        feature("Two points", "area", { type: "Polygon", coordinates: [[[-6.16, 53.405], [-6.159, 53.405], [-6.159, 53.405], [-6.16, 53.405]]] }),
      ),
    );
    expect(result).toEqual({
      ok: true,
      loaded: 1,
      unchanged: 0,
      skipped: [
        "Object 2: the address is missing",
        "Object 3: the address is longer than 100 characters",
        "Object 4: the kind temp is not allowed in the file",
        "Object 5: the kind must be house, appt, facility, spot, area, not shop",
        "Object 6: the kind area needs a Polygon",
        "Object 7: a Polygon needs the kind area",
        "Object 8: the polygon has no valid ring",
        "Object 9: the point has no valid coordinates",
        "Object 10: the line needs at least 2 valid points",
        "Object 11: the polygon must have one ring",
        "Object 12: the point has no valid coordinates",
        "Object 13: the polygon needs at least 3 points",
      ],
    });
    expect(incoming(sqlite).map((row: any) => row.text)).toEqual(["Fine"]);
  });

  it("gives a feature without a kind house for a point, spot for a line and area for a polygon", async () => {
    const { db, sqlite } = fakeD1();
    const line = { type: "LineString", coordinates: [[-6.16, 53.405], [-6.159, 53.405]] };
    const area = { type: "Polygon", coordinates: [[[-6.16, 53.405], [-6.159, 53.405], [-6.159, 53.406], [-6.16, 53.405]]] };
    expect(
      await load(db, file(feature("A", undefined, point(-6.16, 53.405)), feature("B", undefined, line), feature("C", undefined, area))),
    ).toEqual({ ok: true, loaded: 3, unchanged: 0, skipped: [] });
    expect(incoming(sqlite).map((row: any) => [row.text, row.kind])).toEqual([["A", "house"], ["B", "spot"], ["C", "area"]]);
  });

  it("loads addresses whose text is in the directory more than once or in the file more than once", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "Main St", "spot", point(-6.16, 53.405));
    addDirectory(sqlite, "Main St", "spot", point(-6.161, 53.405));
    expect(await load(db, file(feature("Main St", "spot", point(-6.162, 53.405))))).toEqual({
      ok: true,
      loaded: 1,
      unchanged: 0,
      skipped: [],
    });
    expect(
      await load(db,
        file(feature("5 New St", "house", point(-6.162, 53.405)), feature("5 new st", "house", point(-6.163, 53.405))),
      ),
    ).toEqual({ ok: true, loaded: 2, unchanged: 0, skipped: [] });
    expect(incoming(sqlite)).toHaveLength(3);
  });
});

describe("the name of a facility in the file", () => {
  const named = (address: string, kind: unknown, geometry: unknown, name: unknown) => ({
    type: "Feature",
    properties: { address, kind, name },
    geometry,
  });
  const names = (sqlite: Sqlite) => sqlite.prepare("SELECT text, name FROM incoming_addresses ORDER BY id").all();

  it("is exported only for a facility that has one", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "19 Parkside Row", "facility", point(-6.16, 53.405));
    addDirectory(sqlite, "21 Parkside Row", "facility", point(-6.161, 53.405));
    sqlite.prepare("UPDATE addresses SET name = 'Little Rainbows' WHERE text = '19 Parkside Row'").run();
    const exported = JSON.parse(await exportDirectory(db));
    expect(exported.features.map((item: { properties: object }) => item.properties)).toEqual([
      { address: "19 Parkside Row", kind: "facility", source: "walk", name: "Little Rainbows" },
      { address: "21 Parkside Row", kind: "facility", source: "walk" },
    ]);
  });

  it("is loaded for a facility, trimmed, and ignored for any other kind or when empty", async () => {
    const { db, sqlite } = fakeD1();
    const result = await load(
      db,
      file(
        named("19 Parkside Row", "facility", point(-6.16, 53.405), "  Little Rainbows "),
        named("1 Main St", "house", point(-6.161, 53.405), "Not a facility"),
        named("21 Parkside Row", "facility", point(-6.162, 53.405), "   "),
        named("23 Parkside Row", "facility", point(-6.163, 53.405), 5),
      ),
    );
    expect(result).toMatchObject({ ok: true, loaded: 4, skipped: [] });
    expect(names(sqlite)).toEqual([
      { text: "19 Parkside Row", name: "Little Rainbows" },
      { text: "1 Main St", name: null },
      { text: "21 Parkside Row", name: null },
      { text: "23 Parkside Row", name: null },
    ]);
  });

  it("skips a facility whose name is longer than 100 characters, and lists it", async () => {
    const { db, sqlite } = fakeD1();
    const result = await load(
      db,
      file(named("19 Parkside Row", "facility", point(-6.16, 53.405), "x".repeat(101)), named("21 Parkside Row", "facility", point(-6.161, 53.405), "x".repeat(100))),
    );
    expect(result).toMatchObject({ ok: true, loaded: 1, skipped: ["Object 1: the name is longer than 100 characters"] });
    expect(names(sqlite)).toHaveLength(1);
  });

  it("counts a changed name as a change and an unchanged name as unchanged", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "19 Parkside Row", "facility", point(-6.16, 53.405));
    sqlite.prepare("UPDATE addresses SET name = 'Little Rainbows'").run();
    const same = await load(db, file(named("19 Parkside Row", "facility", point(-6.16, 53.405), "Little Rainbows")));
    expect(same).toMatchObject({ ok: true, loaded: 0, unchanged: 1 });
    const renamed = await load(db, file(named("19 Parkside Row", "facility", point(-6.16, 53.405), "Rainbows Creche")));
    expect(renamed).toMatchObject({ ok: true, loaded: 1, unchanged: 0 });
    expect(names(sqlite)).toEqual([{ text: "19 Parkside Row", name: "Rainbows Creche" }]);
    const again = await load(db, file(named("19 Parkside Row", "facility", point(-6.16, 53.405), "Rainbows Creche")));
    expect(again).toMatchObject({ ok: true, loaded: 0, unchanged: 1 });
  });
});
