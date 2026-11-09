import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { exportDirectory, importDirectoryFile } from "./directoryFile";

type Sqlite = ReturnType<typeof fakeD1>["sqlite"];

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
    const result = await importDirectoryFile(
      db,
      file(
        feature("1 Main St", "house", point(-6.160000001, 53.405), "osm"),
        feature("2 Main St", "house", point(-6.1602, 53.405), "walk"),
        feature("3 Main St", "facility", point(-6.1603, 53.405)),
        feature("3 Main St", "facility", point(-6.1603, 53.405)),
      ),
    );
    expect(result).toEqual({ ok: true, loaded: 2, unchanged: 2 });
    expect(incoming(sqlite)).toEqual([
      { source: "walk", text: "2 Main St", kind: "house", geometry: JSON.stringify(point(-6.1602, 53.405)), decision: null },
      { source: "walk", text: "3 Main St", kind: "facility", geometry: JSON.stringify(point(-6.1603, 53.405)), decision: null },
    ]);
  });

  it("loads a changed OSM address with the source walk", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "1 Main St", "house", point(-6.16, 53.405), "osm");
    await importDirectoryFile(db, file(feature("1 Main St", "appt", point(-6.16, 53.405), "osm")));
    expect(incoming(sqlite)).toEqual([expect.objectContaining({ source: "walk", kind: "appt" })]);
  });

  it("adds nothing when the same file is sent again", async () => {
    const { db, sqlite } = fakeD1();
    const sent = file(feature("3 Main St", "house", point(-6.1603, 53.405)));
    await importDirectoryFile(db, sent);
    expect(await importDirectoryFile(db, sent)).toEqual({ ok: true, loaded: 0, unchanged: 1 });
    expect(incoming(sqlite)).toHaveLength(1);
  });

  it("does not insert an address twice when two loads read the same state", async () => {
    const { db, sqlite } = fakeD1();
    const sent = file(feature("3 Main St", "house", point(-6.1603, 53.405)));
    await Promise.all([importDirectoryFile(db, sent), importDirectoryFile(db, sent)]);
    expect(incoming(sqlite)).toHaveLength(1);
  });

  it("says when the file is not a GeoJSON FeatureCollection", async () => {
    const { db } = fakeD1();
    expect(await importDirectoryFile(db, "not json")).toEqual({ ok: false, reason: "not_geojson" });
    expect(await importDirectoryFile(db, JSON.stringify({ type: "Feature" }))).toEqual({ ok: false, reason: "not_geojson" });
  });

  it("loads nothing and lists every error of the features", async () => {
    const { db, sqlite } = fakeD1();
    const ring = [[-6.16, 53.405], [-6.159, 53.405], [-6.159, 53.406], [-6.16, 53.405]];
    const result = await importDirectoryFile(
      db,
      file(
        feature("Fine", "house", point(-6.16, 53.405)),
        feature("", "house", point(-6.16, 53.405)),
        feature("x".repeat(101), "house", point(-6.16, 53.405)),
        feature("No kind", undefined, point(-6.16, 53.405)),
        feature("Temp", "temp", point(-6.16, 53.405)),
        feature("Odd kind", "shop", point(-6.16, 53.405)),
        feature("Area point", "area", point(-6.16, 53.405)),
        feature("Polygon house", "house", { type: "Polygon", coordinates: [ring] }),
        feature("Open", "area", { type: "Polygon", coordinates: [ring.slice(0, 3)] }),
        feature("Far", "house", point(-6.16, 95)),
        feature("Short line", "spot", { type: "LineString", coordinates: [[-6.16, 53.405]] }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      reason: "errors",
      errors: [
        "Feature 2 (): the address is missing",
        `Feature 3 (${"x".repeat(101)}): the address is longer than 100 characters`,
        "Feature 4 (No kind): the kind is missing",
        "Feature 5 (Temp): the kind temp is not allowed in the file",
        "Feature 6 (Odd kind): the kind must be house, appt, facility, spot, area, not shop",
        "Feature 7 (Area point): the kind area needs a Polygon",
        "Feature 8 (Polygon house): a Polygon needs the kind area",
        "Feature 9 (Open): the polygon has no valid ring",
        "Feature 10 (Far): the point has no valid coordinates",
        "Feature 11 (Short line): the line needs at least 2 valid points",
      ],
    });
    expect(incoming(sqlite)).toEqual([]);
  });

  it("loads nothing when a changed text is in the directory twice or in the file twice", async () => {
    const { db, sqlite } = fakeD1();
    addDirectory(sqlite, "Main St", "spot", point(-6.16, 53.405));
    addDirectory(sqlite, "Main St", "spot", point(-6.161, 53.405));
    expect(await importDirectoryFile(db, file(feature("Main St", "spot", point(-6.162, 53.405))))).toEqual({
      ok: false,
      reason: "errors",
      errors: ['"Main St" is in the directory 2 times: fix it in Edit directory'],
    });
    expect(
      await importDirectoryFile(
        db,
        file(feature("5 New St", "house", point(-6.162, 53.405)), feature("5 new st", "house", point(-6.163, 53.405))),
      ),
    ).toEqual({ ok: false, reason: "errors", errors: ['"5 New St" is in the file 2 times as new or changed: leave one of them'] });
    expect(incoming(sqlite)).toEqual([]);
  });
});
