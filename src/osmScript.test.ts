import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A point inside the district and one far outside it.
const INSIDE = { lat: 53.4059, lon: -6.1636 };
const OUTSIDE = { lat: 53.5, lon: -6.0 };

const element = (id: number, place: { lat: number; lon: number }, tags: Record<string, string>) => ({
  type: "way",
  id,
  center: place,
  tags,
});

function osmFile(elements: object[]): string {
  const file = join(mkdtempSync(join(tmpdir(), "osm-")), "osm-test.json");
  writeFileSync(file, JSON.stringify({ elements }));
  return file;
}

// A stand-in for npx: answers the check "was the file loaded" with no rows and prints the SQL file it is given.
function fakeNpx(): string {
  const dir = mkdtempSync(join(tmpdir(), "npx-"));
  const script = join(dir, "npx");
  writeFileSync(
    script,
    `#!/bin/sh
for a in "$@"; do
  case "$a" in
    --json) echo '[{"results":[]}]'; exit 0;;
    --file=*) cat "\${a#--file=}"; exit 0;;
  esac
done
`,
  );
  chmodSync(script, 0o755);
  return dir;
}

describe("scripts/load-osm.mjs", () => {
  it("loads nothing and lists the objects without coordinates, without a number and with a long address", () => {
    const file = osmFile([
      { type: "node", id: 1, tags: { "addr:housenumber": "1", "addr:street": "Main Street" } },
      element(2, INSIDE, { "addr:street": "Main Street" }),
      element(3, INSIDE, { "addr:housenumber": "1", "addr:street": "A".repeat(100) }),
      element(4, INSIDE, { "addr:housenumber": "2", "addr:street": "Main Street" }),
      element(5, INSIDE, {}),
    ]);
    const result = spawnSync("node", ["scripts/load-osm.mjs", file], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing loaded");
    expect(result.stderr).toContain("node 1: no coordinates");
    expect(result.stderr).toContain("way 2: the house number is missing");
    expect(result.stderr).toContain("way 3 (1 AAAA");
    expect(result.stderr).toContain("the address is longer than 100 characters");
    expect(result.stderr).toContain("way 5: the house number is missing");
    expect(result.stderr).not.toContain("way 4");
    expect(result.stdout).not.toContain("addresses to load");
  });
  it("loads the objects inside the district that have a street, with their kind and the source osm", () => {
    const file = osmFile([
      element(10, INSIDE, { "addr:housenumber": "2", "addr:street": "Main Street", building: "house" }),
      element(11, INSIDE, { "addr:housenumber": "7", "addr:street": "Belmayne Avenue", building: "apartments" }),
      element(12, INSIDE, { "addr:housenumber": "19", "addr:street": "Parkside Row", amenity: "childcare", name: "Little Rainbows" }),
      element(13, INSIDE, { "addr:housenumber": "5", "addr:street": "Parkside Drive", building: "yes" }),
      element(14, INSIDE, { "addr:housenumber": "26", building: "house" }),
      { type: "node", id: 16, lat: INSIDE.lat, lon: INSIDE.lon, tags: { "addr:housenumber": "3", "addr:street": "Parkside Way" } },
      element(15, OUTSIDE, { "addr:housenumber": "1", "addr:street": "Far Road" }),
    ]);
    const result = spawnSync("node", ["scripts/load-osm.mjs", file], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeNpx()}:${process.env.PATH}` },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("5 addresses to load");
    expect(result.stdout).toContain("outside the district: 1, without a street, skipped: 1");
    expect(result.stdout).toContain(`SELECT 'osm', '2 Main St', 'house', '{"type":"Point","coordinates":[-6.1636,53.4059]}', 'osm-test.json'`);
    expect(result.stdout).toContain("SELECT 'osm', '7 Belmayne Avenue', 'appt'");
    expect(result.stdout).toContain("SELECT 'osm', '19 Parkside Row', 'facility'");
    expect(result.stdout).toContain("SELECT 'osm', '5 Parkside Drive', 'house'");
    expect(result.stdout).toContain("SELECT 'osm', '3 Parkside Way', 'house', '{\"type\":\"Point\",\"coordinates\":[-6.1636,53.4059]}'");
    expect(result.stdout).not.toContain("Far Road");
    expect(result.stdout).toContain("INSERT OR IGNORE INTO walk_files (name, loaded_at) VALUES ('osm-test.json'");
  });
});
