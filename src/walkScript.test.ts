import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const feature = (address: string, kind: unknown, geometry: object) => ({
  type: "Feature",
  properties: kind === undefined ? { address } : { address, kind },
  geometry,
});
const point = { type: "Point", coordinates: [-6.1, 53.4] };
const polygon = { type: "Polygon", coordinates: [[[-6.1, 53.4], [-6.1, 53.41], [-6.09, 53.41], [-6.1, 53.4]]] };

describe("scripts/load-walk.mjs", () => {
  it("loads nothing and lists every kind error of the file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "walk-")), "walk-test.geojson");
    writeFileSync(
      file,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          feature("A", undefined, point),
          feature("B", "temp", point),
          feature("C", "point", point),
          feature("D", "area", point),
          feature("E", "house", polygon),
          feature("Fine", "house", point),
        ],
      }),
    );
    const result = spawnSync("node", ["scripts/load-walk.mjs", file], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing loaded");
    expect(result.stderr).toContain("Feature 1 (A): the kind is missing");
    expect(result.stderr).toContain("Feature 2 (B): the kind temp is not allowed in a walk file");
    expect(result.stderr).toContain("Feature 3 (C): the kind must be house, appt, facility, spot, area, not point");
    expect(result.stderr).toContain("Feature 4 (D): the kind area needs a Polygon");
    expect(result.stderr).toContain("Feature 5 (E): a Polygon needs the kind area");
    expect(result.stderr).not.toContain("Fine");
    expect(result.stdout).not.toContain("addresses in");
  });
});
