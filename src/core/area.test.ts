import { describe, expect, it } from "vitest";
import { isInArea, parseArea } from "./area";

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
