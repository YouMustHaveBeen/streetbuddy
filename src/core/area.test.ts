import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isInArea, M_PER_DEG, parseArea } from "./area";

// Same shape as config/area.geojson.
const geojson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { county: "Dublin", postal_district: "D13" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-6.1716713, 53.4075915],
            [-6.1637319, 53.4090497],
            [-6.1566509, 53.4084868],
            [-6.1576379, 53.4025002],
            [-6.1659206, 53.4022444],
            [-6.1719288, 53.4029352],
            [-6.1719717, 53.4029608],
            [-6.1716713, 53.4075915],
          ],
        ],
      },
    },
  ],
};

const area = parseArea(geojson);

const M_PER_DEG_LAT = 111195;
const northMidLat = (53.4090497 + 53.4084868) / 2;
const northMidLon = (-6.1637319 + -6.1566509) / 2;
const metresNorth = (m: number) => m / M_PER_DEG_LAT;
const metresWest = (m: number, lat: number) => m / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

describe("isInArea", () => {
  it("accepts a point inside", () => {
    expect(isInArea(area, 53.4055, -6.165)).toBe(true);
  });

  it("accepts a point on the border", () => {
    expect(isInArea(area, northMidLat, northMidLon)).toBe(true);
  });

  it("accepts a point 40 m outside the border (within the margin)", () => {
    expect(isInArea(area, northMidLat + metresNorth(40), northMidLon)).toBe(true);
  });

  it("rejects a point 60 m outside the border", () => {
    expect(isInArea(area, northMidLat + metresNorth(60), northMidLon)).toBe(false);
  });

  it("measures the margin from a corner", () => {
    const cornerLat = 53.4075915;
    const cornerLon = -6.1716713;
    expect(isInArea(area, cornerLat, cornerLon - metresWest(30, cornerLat))).toBe(true);
    expect(isInArea(area, cornerLat, cornerLon - metresWest(80, cornerLat))).toBe(false);
  });

  it("rejects a point far away", () => {
    expect(isInArea(area, 53.3498, -6.2603)).toBe(false);
  });

  it("rejects NaN and infinite input", () => {
    expect(isInArea(area, NaN, -6.165)).toBe(false);
    expect(isInArea(area, 53.4055, NaN)).toBe(false);
    expect(isInArea(area, Infinity, -6.165)).toBe(false);
  });
});

describe("parseArea", () => {
  it("reads county and drops the closing duplicate point", () => {
    expect(area.county).toBe("Dublin");
    expect(area.ring).toHaveLength(7);
  });

  it("rejects malformed input", () => {
    expect(() => parseArea(null)).toThrow();
    expect(() => parseArea({})).toThrow();
    expect(() => parseArea({ features: [] })).toThrow();
  });

  it("rejects a missing county", () => {
    const broken = structuredClone(geojson);
    broken.features[0].properties = { postal_district: "D13" } as (typeof geojson)["features"][0]["properties"];
    expect(() => parseArea(broken)).toThrow();
  });

  it("rejects a missing postal district", () => {
    const broken = structuredClone(geojson);
    broken.features[0].properties = { county: "Dublin" } as (typeof geojson)["features"][0]["properties"];
    expect(() => parseArea(broken)).toThrow();
  });

  it("rejects a non-polygon geometry", () => {
    const broken = structuredClone(geojson) as { features: { geometry: { type: string } }[] };
    broken.features[0].geometry.type = "Point";
    expect(() => parseArea(broken)).toThrow();
  });

  it("rejects an invalid coordinate", () => {
    const broken = structuredClone(geojson) as { features: { geometry: { coordinates: unknown[][][] } }[] };
    broken.features[0].geometry.coordinates[0][1] = ["x", 53];
    expect(() => parseArea(broken)).toThrow();
  });

  it("rejects a polygon with fewer than 3 points", () => {
    const broken = structuredClone(geojson) as { features: { geometry: { coordinates: unknown[][][] } }[] };
    broken.features[0].geometry.coordinates[0] = [
      [-6.17, 53.4],
      [-6.16, 53.41],
    ];
    expect(() => parseArea(broken)).toThrow();
  });
});

// Checks config/area.geojson itself, not a fixture, so a bad redraw on geojson.io
// (unclosed ring, self-intersection, flipped lat/lon) does not pass silently.
describe("config/area.geojson", () => {
  const raw = JSON.parse(readFileSync("config/area.geojson", "utf8"));
  const rawRing = raw.features[0].geometry.coordinates[0] as [number, number][];
  const realArea = parseArea(raw);

  it("has a closed outer ring with at least 4 points", () => {
    expect(rawRing.length).toBeGreaterThanOrEqual(4);
    expect(rawRing[0]).toEqual(rawRing[rawRing.length - 1]);
  });

  it("has no self-intersecting edges", () => {
    const ring = realArea.ring;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a1 = ring[i];
      const a2 = ring[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        // Adjacent edges share an endpoint by construction; that is not a crossing.
        if (j === i || (j + 1) % n === i) continue;
        const b1 = ring[j];
        const b2 = ring[(j + 1) % n];
        expect(segmentsCross(a1, a2, b1, b2)).toBe(false);
      }
    }
  });

  it("has a plausible area and bounding box (catches a flipped lat/lon or a stray vertex)", () => {
    const lons = realArea.ring.map(([lon]) => lon);
    const lats = realArea.ring.map(([, lat]) => lat);
    const west = Math.min(...lons);
    const east = Math.max(...lons);
    const south = Math.min(...lats);
    const north = Math.max(...lats);
    const avgLat = (south + north) / 2;
    const lonScale = M_PER_DEG * Math.cos((avgLat * Math.PI) / 180);
    const widthKm = ((east - west) * lonScale) / 1000;
    const heightKm = ((north - south) * M_PER_DEG) / 1000;
    expect(widthKm).toBeGreaterThan(0.2);
    expect(widthKm).toBeLessThan(3);
    expect(heightKm).toBeGreaterThan(0.2);
    expect(heightKm).toBeLessThan(3);

    let shoelace = 0;
    for (let i = 0, j = realArea.ring.length - 1; i < realArea.ring.length; j = i++) {
      shoelace += realArea.ring[j][0] * realArea.ring[i][1] - realArea.ring[i][0] * realArea.ring[j][1];
    }
    const areaKm2 = (Math.abs(shoelace) / 2) * M_PER_DEG * lonScale / 1e6;
    expect(areaKm2).toBeGreaterThan(0.05);
    expect(areaKm2).toBeLessThan(5);
  });

  it("accepts a known point inside and rejects a point far away", () => {
    expect(isInArea(realArea, 53.4055, -6.165)).toBe(true);
    expect(isInArea(realArea, 53.3498, -6.2603)).toBe(false);
  });
});

// True if open segments (a1,a2) and (b1,b2) cross (touching only at a shared
// endpoint, which adjacent polygon edges always do, does not count).
function segmentsCross(a1: [number, number], a2: [number, number], b1: [number, number], b2: [number, number]) {
  const d = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return (d1 * d2 < 0) && (d3 * d4 < 0);
}
