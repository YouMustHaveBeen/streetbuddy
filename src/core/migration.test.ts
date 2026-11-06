import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const sql = (file: string) => readFileSync(`migrations/${file}`, "utf8");
const before = () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort().filter((name) => name < "0011")) sqlite.exec(sql(file));
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
