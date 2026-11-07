// The data of the two map pages: the places of the reports of a period, and the address directory.
import { DAY_MS } from "./shared";
import { shapeFromGeometry, shapeMiddle } from "./shapes";
import { dublinDay, groupPlaces } from "./stats";
import type { PlaceRow } from "./stats";

export const MAP_PERIODS = ["today", "week", "last_month", "month_before"] as const;
export type MapPeriod = (typeof MAP_PERIODS)[number];

export interface ReportPlace {
  lat: number;
  lon: number;
  // The place is a directory address of the kind facility.
  facility: boolean;
  // One date (dd/mm/yyyy) for every report of the place, the latest first.
  dates: string[];
}

export interface DirectoryItem {
  text: string;
  kind: string;
  geometry: unknown;
}

interface MapRow extends PlaceRow {
  day: string;
  kind: string | null;
  geometry: string | null;
}

const parseDay = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return { year, month, date };
};
const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The day (yyyy-mm-dd) that is `days` days after the given one.
const shiftDays = (day: string, days: number): string => {
  const { year, month, date } = parseDay(day);
  return formatDay(Date.UTC(year, month - 1, date + days));
};

// The same day number `months` months after the given day, or the last day of that month when it
// has no such number.
const shiftMonths = (day: string, months: number): string => {
  const { year, month, date } = parseDay(day);
  const lastDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return formatDay(Date.UTC(year, month - 1 + months, 1) + (Math.min(date, lastDay) - 1) * DAY_MS);
};

// The first and the last day (yyyy-mm-dd, Dublin) of a period.
export function mapPeriodDays(period: MapPeriod, now: number): { from: string; to: string } {
  const today = dublinDay(now);
  const yesterday = shiftDays(today, -1);
  if (period === "today") return { from: today, to: today };
  if (period === "week") return { from: shiftDays(today, -7), to: yesterday };
  if (period === "last_month") return { from: shiftMonths(today, -1), to: yesterday };
  return { from: shiftMonths(today, -2), to: shiftDays(shiftMonths(today, -1), -1) };
}

// The places of the reports of the period, grouped as in the hotspots; a place with a directory
// address is shown at that address. Plates are not passed on. One read of the whole log.
export async function getReportPlaces(db: D1Database, period: MapPeriod, now: number): Promise<ReportPlace[]> {
  const { from, to } = mapPeriodDays(period, now);
  const { results } = await db
    .prepare(
      `SELECT r.plate, r.address, r.lat, r.lon, r.created_at, r.address_id, r.day, a.kind, a.geometry
       FROM report_log r LEFT JOIN addresses a ON a.id = r.address_id ORDER BY r.created_at`,
    )
    .all<MapRow>();
  const dayOf = (row: MapRow) => row.day || dublinDay(row.created_at);
  const inPeriod = results.filter((row) => dayOf(row) >= from && dayOf(row) <= to);
  return groupPlaces(inPeriod).map((group) => {
    const first = group[0];
    const shape = first.geometry ? shapeFromGeometry(JSON.parse(first.geometry)) : null;
    const spot = shape ? shapeMiddle(shape) : { lat: first.lat, lon: first.lon };
    return {
      lat: spot.lat,
      lon: spot.lon,
      facility: first.kind === "facility",
      dates: group.map((row) => dayOf(row).split("-").reverse().join("/")).reverse(),
    };
  });
}

// Every address of the directory with its GeoJSON geometry.
export async function getDirectoryItems(db: D1Database): Promise<DirectoryItem[]> {
  const { results } = await db.prepare("SELECT text, kind, geometry FROM addresses").all<{
    text: string;
    kind: string;
    geometry: string;
  }>();
  return results.flatMap((row) => {
    const geometry: unknown = JSON.parse(row.geometry);
    return shapeFromGeometry(geometry) ? [{ text: row.text, kind: row.kind, geometry }] : [];
  });
}
