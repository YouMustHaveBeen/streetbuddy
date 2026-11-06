// Area check: is a point inside the working district (polygon from
// config/area.geojson) or within the 50 m margin around its border.

const AREA_MARGIN_M = 50;

const EARTH_RADIUS_M = 6371008.8;
export const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;

export interface Area {
  county: string;
  postalDistrict: string;
  // Polygon ring as [longitude, latitude] pairs.
  ring: [number, number][];
}

// Reads the district from the parsed contents of config/area.geojson:
// a FeatureCollection with one Polygon feature and properties.county, .postal_district.
export function parseArea(geojson: unknown): Area {
  const features = (geojson as { features?: unknown })?.features;
  if (!Array.isArray(features) || features.length !== 1) {
    throw new Error("area.geojson must contain exactly one feature");
  }
  const feature = features[0] as {
    properties?: { county?: unknown; postal_district?: unknown };
    geometry?: { type?: unknown; coordinates?: unknown };
  };
  const county = feature.properties?.county;
  if (typeof county !== "string" || county === "") {
    throw new Error("area.geojson: properties.county is missing");
  }
  const postalDistrict = feature.properties?.postal_district;
  if (typeof postalDistrict !== "string" || postalDistrict === "") {
    throw new Error("area.geojson: properties.postal_district is missing");
  }
  if (feature.geometry?.type !== "Polygon") {
    throw new Error("area.geojson: geometry must be a Polygon");
  }
  const rings = feature.geometry.coordinates;
  if (!Array.isArray(rings) || !Array.isArray(rings[0])) {
    throw new Error("area.geojson: polygon has no outer ring");
  }
  const ring: [number, number][] = [];
  for (const point of rings[0] as unknown[]) {
    if (
      !Array.isArray(point) ||
      typeof point[0] !== "number" ||
      typeof point[1] !== "number" ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      throw new Error("area.geojson: invalid coordinate");
    }
    ring.push([point[0], point[1]]);
  }
  // Drop the closing point if it repeats the first one.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    ring.pop();
  }
  if (ring.length < 3) {
    throw new Error("area.geojson: polygon needs at least 3 points");
  }
  return { county, postalDistrict, ring };
}

// Distance in metres between two points, on a flat local map.
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * M_PER_DEG;
  const dLon = (bLon - aLon) * M_PER_DEG * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

// Distance in metres from the origin (0, 0) to the segment (ax, ay)-(bx, by).
export function distanceToSegment(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : -(ax * dx + ay * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// True if the point is inside the polygon or within AREA_MARGIN_M of its border.
// Arguments: latitude first, then longitude (GeoJSON itself stores longitude first).
export function isInArea(area: Area, lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const ring = area.ring;
  const cosLat = Math.cos((lat * Math.PI) / 180);

  // Local flat coordinates in metres, with the point at the origin.
  const local = ring.map(([ptLon, ptLat]): [number, number] => [
    (ptLon - lon) * cosLat * M_PER_DEG,
    (ptLat - lat) * M_PER_DEG,
  ]);

  let minDistance = Infinity;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    const [xi, yi] = local[i];
    const [xj, yj] = local[j];
    minDistance = Math.min(minDistance, distanceToSegment(xi, yi, xj, yj));
  }
  return insideRing(local, 0, 0) || minDistance <= AREA_MARGIN_M;
}

// True if (x, y) is inside the ring of flat coordinates: ray casting, counting border crossings
// of a ray going to the right.
export function insideRing(ring: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
