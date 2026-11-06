// Shapes of the address directory (point, line, area) and distances to them, on a flat local map.
import { distanceToSegment, insideRing, M_PER_DEG } from "./area";

export type ShapeKind = "point" | "line" | "area";

type LonLat = [number, number];
type XY = [number, number];

// parts: one part with one point for a point; the lines of a line; the ring of an area, without
// the closing point. Coordinates are [longitude, latitude], as in GeoJSON.
export interface Shape {
  kind: ShapeKind;
  parts: LonLat[][];
}

const isLonLat = (value: unknown): value is LonLat =>
  Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);

const isLine = (value: unknown): value is LonLat[] => Array.isArray(value) && value.length >= 2 && value.every(isLonLat);

// The shape of a GeoJSON geometry (Point, LineString, MultiLineString, Polygon with its outer
// ring); null for anything else.
export function shapeFromGeometry(geometry: unknown): Shape | null {
  const { type, coordinates } = (geometry ?? {}) as { type?: unknown; coordinates?: unknown };
  if (type === "Point" && isLonLat(coordinates)) {
    return { kind: "point", parts: [[[coordinates[0], coordinates[1]]]] };
  }
  if (type === "LineString" && isLine(coordinates)) {
    return { kind: "line", parts: [coordinates.map(([lon, lat]) => [lon, lat])] };
  }
  if (type === "MultiLineString" && Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isLine)) {
    return { kind: "line", parts: coordinates.map((line) => line.map(([lon, lat]): LonLat => [lon, lat])) };
  }
  if (type === "Polygon" && Array.isArray(coordinates) && isLine(coordinates[0])) {
    const ring = coordinates[0].map(([lon, lat]): LonLat => [lon, lat]);
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
    return ring.length >= 3 ? { kind: "area", parts: [ring] } : null;
  }
  return null;
}

// GeoJSON geometry of a point.
export const pointGeometry = (lat: number, lon: number) => ({ type: "Point", coordinates: [lon, lat] });

export function shapeBounds(shape: Shape): { west: number; south: number; east: number; north: number } {
  const points = shape.parts.flat();
  return {
    west: Math.min(...points.map(([lon]) => lon)),
    south: Math.min(...points.map(([, lat]) => lat)),
    east: Math.max(...points.map(([lon]) => lon)),
    north: Math.max(...points.map(([, lat]) => lat)),
  };
}

interface Flat {
  vertices: XY[];
  // Segments of lines and of the closed ring; a point gives one segment of zero length.
  segments: [XY, XY][];
  ring: XY[] | null;
}

function flatten(shape: Shape, refLat: number, refLon: number): Flat {
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  const toXY = ([lon, lat]: LonLat): XY => [(lon - refLon) * cosLat * M_PER_DEG, (lat - refLat) * M_PER_DEG];
  const parts = shape.parts.map((part) => part.map(toXY));
  const segments: [XY, XY][] = [];
  for (const part of parts) {
    if (part.length === 1) segments.push([part[0], part[0]]);
    for (let i = 1; i < part.length; i++) segments.push([part[i - 1], part[i]]);
    if (shape.kind === "area") segments.push([part[part.length - 1], part[0]]);
  }
  return { vertices: parts.flat(), segments, ring: shape.kind === "area" ? parts[0] : null };
}

const fromPoint = ([px, py]: XY, [[ax, ay], [bx, by]]: [XY, XY]) => distanceToSegment(ax - px, ay - py, bx - px, by - py);

const side = ([ax, ay]: XY, [bx, by]: XY, [cx, cy]: XY) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

// True when the two segments cross each other.
const cross = ([a, b]: [XY, XY], [c, d]: [XY, XY]) =>
  side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;

// Metres from the point to the shape: 0 inside an area, otherwise to its nearest point.
export function distanceToShape(shape: Shape, lat: number, lon: number): number {
  const flat = flatten(shape, lat, lon);
  if (flat.ring && insideRing(flat.ring, 0, 0)) return 0;
  return Math.min(...flat.segments.map((segment) => fromPoint([0, 0], segment)));
}

// The least distance in metres between two shapes: 0 when they cross or one is inside the other.
export function distanceBetween(a: Shape, b: Shape): number {
  const [refLon, refLat] = a.parts[0][0];
  const fa = flatten(a, refLat, refLon);
  const fb = flatten(b, refLat, refLon);
  if (fa.segments.some((sa) => fb.segments.some((sb) => cross(sa, sb)))) return 0;
  if (fb.ring && fa.vertices.some(([x, y]) => insideRing(fb.ring as XY[], x, y))) return 0;
  if (fa.ring && fb.vertices.some(([x, y]) => insideRing(fa.ring as XY[], x, y))) return 0;
  let least = Infinity;
  for (const vertex of fa.vertices) for (const segment of fb.segments) least = Math.min(least, fromPoint(vertex, segment));
  for (const vertex of fb.vertices) for (const segment of fa.segments) least = Math.min(least, fromPoint(vertex, segment));
  return least;
}

// A point to show the shape on a map: the point itself, the middle of a line along its length,
// the middle of the rectangle around an area.
export function shapeMiddle(shape: Shape): { lat: number; lon: number } {
  if (shape.kind === "area") {
    const { west, south, east, north } = shapeBounds(shape);
    return { lat: (south + north) / 2, lon: (west + east) / 2 };
  }
  const [refLon, refLat] = shape.parts[0][0];
  const flat = flatten(shape, refLat, refLon);
  const length = (s: [XY, XY]) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
  let left = flat.segments.reduce((sum, s) => sum + length(s), 0) / 2;
  let [x, y] = flat.vertices[0];
  for (const segment of flat.segments) {
    const l = length(segment);
    if (left <= l) {
      const t = l === 0 ? 0 : left / l;
      [x, y] = [segment[0][0] + t * (segment[1][0] - segment[0][0]), segment[0][1] + t * (segment[1][1] - segment[0][1])];
      break;
    }
    left -= l;
  }
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  return { lat: refLat + y / M_PER_DEG, lon: refLon + x / (cosLat * M_PER_DEG) };
}
