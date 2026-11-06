import { describe, expect, it } from "vitest";
import { M_PER_DEG } from "./area";
import { distanceBetween, distanceToShape, shapeBounds, shapeFromGeometry, shapeMiddle } from "./shapes";
import type { Shape } from "./shapes";

const LAT = 53.4;
const LON = -6.15;
const COS = Math.cos((LAT * Math.PI) / 180);
// A place x metres east and y metres north of LAT, LON, as [longitude, latitude].
const at = (x: number, y: number): [number, number] => [LON + x / (M_PER_DEG * COS), LAT + y / M_PER_DEG];

const point = (x: number, y: number) => shapeFromGeometry({ type: "Point", coordinates: at(x, y) }) as Shape;
const line = (...points: [number, number][]) =>
  shapeFromGeometry({ type: "LineString", coordinates: points.map(([x, y]) => at(x, y)) }) as Shape;
const square = (x: number, y: number, side: number) =>
  shapeFromGeometry({
    type: "Polygon",
    coordinates: [[at(x, y), at(x + side, y), at(x + side, y + side), at(x, y + side), at(x, y)]],
  }) as Shape;

describe("shapeFromGeometry", () => {
  it("reads the four kinds of geometry and drops the closing point of a ring", () => {
    expect(point(0, 0).kind).toBe("point");
    expect(line([0, 0], [10, 0]).kind).toBe("line");
    expect(
      shapeFromGeometry({ type: "MultiLineString", coordinates: [[at(0, 0), at(1, 0)], [at(5, 0), at(6, 0)]] })?.parts,
    ).toHaveLength(2);
    const area = square(0, 0, 10);
    expect(area.kind).toBe("area");
    expect(area.parts[0]).toHaveLength(4);
  });
  it("gives null for anything else", () => {
    expect(shapeFromGeometry({ type: "Polygon", coordinates: [[at(0, 0), at(1, 0), at(0, 0)]] })).toBeNull();
    expect(shapeFromGeometry({ type: "LineString", coordinates: [at(0, 0)] })).toBeNull();
    expect(shapeFromGeometry({ type: "Point", coordinates: ["a", 1] })).toBeNull();
    expect(shapeFromGeometry({ type: "Point", coordinates: [181, 53] })).toBeNull();
    expect(shapeFromGeometry({ type: "Point", coordinates: [-6, 91] })).toBeNull();
    expect(shapeFromGeometry({ type: "MultiPoint", coordinates: [at(0, 0)] })).toBeNull();
    expect(shapeFromGeometry(null)).toBeNull();
  });
  it("gives the rectangle around a shape", () => {
    const [west, south] = at(0, 0);
    const [east, north] = at(10, 20);
    expect(shapeBounds(line([0, 0], [10, 20]))).toEqual({ west, south, east, north });
  });
});

describe("distanceToShape", () => {
  const [lon, lat] = at(0, 0);
  it("measures to a point", () => {
    expect(distanceToShape(point(30, 40), lat, lon)).toBeCloseTo(50, 1);
  });
  it("measures to the nearest point of a line, and to its end", () => {
    expect(distanceToShape(line([-10, 20], [10, 20]), lat, lon)).toBeCloseTo(20, 1);
    expect(distanceToShape(line([30, 0], [50, 0]), lat, lon)).toBeCloseTo(30, 1);
  });
  it("is 0 inside an area and the distance to its border outside", () => {
    expect(distanceToShape(square(-50, -50, 100), lat, lon)).toBe(0);
    expect(distanceToShape(square(10, -5, 20), lat, lon)).toBeCloseTo(10, 1);
  });
});

describe("distanceBetween", () => {
  it("is 0 for crossing lines, and for a shape inside an area", () => {
    expect(distanceBetween(line([0, -10], [0, 10]), line([-10, 0], [10, 0]))).toBe(0);
    expect(distanceBetween(point(5, 5), square(0, 0, 10))).toBe(0);
    expect(distanceBetween(square(0, 0, 100), line([10, 10], [20, 20]))).toBe(0);
  });
  it("measures between points, a point and a line, two areas", () => {
    expect(distanceBetween(point(0, 0), point(3, 4))).toBeCloseTo(5, 1);
    expect(distanceBetween(point(5, 7), line([0, 0], [10, 0]))).toBeCloseTo(7, 1);
    expect(distanceBetween(square(0, 0, 10), square(14, 0, 10))).toBeCloseTo(4, 1);
  });
  it("is the same both ways", () => {
    const a = line([0, 0], [10, 10]);
    const b = square(20, 20, 5);
    // The flat map is centred on the first shape, so the two directions differ by hundredths of a millimetre.
    expect(distanceBetween(a, b)).toBeCloseTo(distanceBetween(b, a), 3);
  });
});

describe("shapeMiddle", () => {
  it("gives the point itself, the middle of a line along its length, the middle of an area", () => {
    const [lon, lat] = at(3, 4);
    expect(shapeMiddle(point(3, 4))).toEqual({ lat, lon });
    const middle = shapeMiddle(line([0, 0], [10, 0], [10, 30]));
    expect(middle.lat).toBeCloseTo(at(10, 10)[1], 9);
    expect(middle.lon).toBeCloseTo(at(10, 10)[0], 9);
    const centre = shapeMiddle(square(0, 0, 20));
    expect(centre.lat).toBeCloseTo(at(10, 10)[1], 9);
    expect(centre.lon).toBeCloseTo(at(10, 10)[0], 9);
  });
});
