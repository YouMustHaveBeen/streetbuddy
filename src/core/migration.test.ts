import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const sql = (file: string) => readFileSync(`migrations/${file}`, "utf8");
const before = (limit = "0011") => {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort().filter((name) => name < limit)) sqlite.exec(sql(file));
  return sqlite;
};

describe("migration 0011", () => {
  it("gives the user addresses the kind temp, and keeps the counter of directory IDs", () => {
    const sqlite = before();
    sqlite.exec(`
      INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES ('A', 'area', '{}', 0, 0, 0, 0);
      INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES ('B', 'area', '{}', 0, 0, 0, 0);
      DELETE FROM addresses WHERE text = 'B';
      INSERT INTO incoming_addresses (source, text, kind, geometry, decision, created_at) VALUES ('user', 'U', 'point', '{}', NULL, 1);
      INSERT INTO incoming_addresses (source, text, kind, geometry, decision, created_at) VALUES ('user', 'V', 'point', '{}', 'approved', 1);
      INSERT INTO incoming_addresses (source, text, kind, geometry, decision, created_at) VALUES ('user', 'W', 'point', '{}', 'rejected', 1);
      INSERT INTO incoming_addresses (source, text, kind, geometry, decision, walk_file, created_at) VALUES ('walk', 'P', 'area', '{}', 'approved', 'walk-1.geojson', 1);
    `);
    sqlite.exec(sql("0011_address_kinds.sql"));
    expect(sqlite.prepare("SELECT text, kind FROM addresses").all()).toEqual([{ text: "A", kind: "area" }]);
    expect(sqlite.prepare("SELECT text, kind, decision FROM incoming_addresses ORDER BY id").all()).toEqual([
      { text: "U", kind: "temp", decision: null },
      { text: "V", kind: "temp", decision: null },
      { text: "W", kind: "temp", decision: "rejected" },
      { text: "P", kind: "area", decision: "approved" },
    ]);
    sqlite.exec("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES ('C', 'house', '{}', 0, 0, 0, 0)");
    expect(sqlite.prepare("SELECT id FROM addresses WHERE text = 'C'").get()).toEqual({ id: 3 });
  });
  it("stops when the directory has an address with an old kind", () => {
    const sqlite = before();
    sqlite.exec("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES ('A', 'point', '{}', 0, 0, 0, 0)");
    expect(() => sqlite.exec(sql("0011_address_kinds.sql"))).toThrow();
  });
});

describe("migration 0013", () => {
  it("gives the addresses in the directory the source walk and keeps the incoming addresses", () => {
    const sqlite = before("0013");
    sqlite.exec(`
      INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES ('A', 'house', '{}', 0, 0, 0, 0);
      INSERT INTO incoming_addresses (source, text, kind, geometry, user_id, decision, created_at) VALUES ('user', 'U', 'temp', '{}', 7, NULL, 1);
      INSERT INTO incoming_addresses (source, text, kind, geometry, decision, walk_file, created_at) VALUES ('walk', 'P', 'area', '{}', 'approved', 'walk-1.geojson', 2);
    `);
    sqlite.exec(sql("0013_address_sources.sql"));
    expect(sqlite.prepare("SELECT text, source FROM addresses").all()).toEqual([{ text: "A", source: "walk" }]);
    expect(sqlite.prepare("SELECT id, source, text, kind, user_id, decision, walk_file, created_at FROM incoming_addresses ORDER BY id").all()).toEqual([
      { id: 1, source: "user", text: "U", kind: "temp", user_id: 7, decision: null, walk_file: null, created_at: 1 },
      { id: 2, source: "walk", text: "P", kind: "area", user_id: null, decision: "approved", walk_file: "walk-1.geojson", created_at: 2 },
    ]);
  });
  it("lets both tables take the source osm and refuses any other", () => {
    const sqlite = before("0014");
    sqlite.exec("INSERT INTO addresses (text, kind, geometry, west, south, east, north, source) VALUES ('A', 'house', '{}', 0, 0, 0, 0, 'osm')");
    sqlite.exec("INSERT INTO incoming_addresses (source, text, kind, geometry, created_at) VALUES ('osm', 'B', 'house', '{}', 1)");
    expect(() => sqlite.exec("INSERT INTO addresses (text, kind, geometry, west, south, east, north, source) VALUES ('C', 'house', '{}', 0, 0, 0, 0, 'google')")).toThrow();
    expect(() => sqlite.exec("INSERT INTO incoming_addresses (source, text, kind, geometry, created_at) VALUES ('google', 'D', 'house', '{}', 1)")).toThrow();
  });
});
