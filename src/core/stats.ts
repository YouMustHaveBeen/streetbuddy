// The report log, the nightly statistics and the hotspots, all in D1.
import { dublinDateTime, PARKING_OPTIONS } from "./report";

// How long a row of the log stays: 2 months.
export const REPORT_LOG_TTL_MS = 60 * 24 * 60 * 60 * 1000;

// Places of the log closer to each other than this count as one place, like in the rule of
// one report per plate and place.
export const HOTSPOT_RADIUS_M = 50;
export const HOTSPOT_COUNT = 5;
// A place with fewer reports is not shown: a few reports could point at one person's home.
export const HOTSPOT_MIN_REPORTS = 10;

const M_PER_DEG = 111_320;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LoggedReport {
  plate: string;
  parking: number;
  address: string;
  lat: number;
  lon: number;
}

export interface Hotspot {
  address: string;
  reports: number;
}

// One row for every link given; there is no Telegram ID in it. Returns the ID of the row.
export async function logReport(db: D1Database, report: LoggedReport): Promise<number> {
  const result = await db
    .prepare(
      "INSERT INTO report_log (created_at, plate, parking, address, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(Date.now(), report.plate, report.parking, report.address, report.lat, report.lon)
    .run();
  return result.meta.last_row_id;
}

export async function getHotspots(db: D1Database): Promise<Hotspot[]> {
  const { results } = await db
    .prepare("SELECT address, reports FROM hotspots ORDER BY rank")
    .all<Hotspot>();
  return results;
}

// Distance in metres between two points, flat-earth like the rest of the area checks:
// the area is far smaller than a degree.
function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * M_PER_DEG;
  const dLon = (bLon - aLon) * M_PER_DEG * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

interface PlaceRow {
  address: string;
  lat: number;
  lon: number;
  created_at: number;
}

// Rows are in time order. A row joins the group that has a point within HOTSPOT_RADIUS_M of it,
// so a chain of close points is one place, and starts a group of its own otherwise; a group is shown by the address
// that occurs in it most often, and by the latest of those when they are equal. Groups of fewer
// than HOTSPOT_MIN_REPORTS reports are left out.
export function topHotspots(rows: readonly PlaceRow[]): Hotspot[] {
  const groups: PlaceRow[][] = [];
  for (const row of rows) {
    // A row within the radius of any row of a group belongs to it; when it touches several
    // groups, they become one.
    const near = groups.filter((g) => g.some((r) => distanceM(r.lat, r.lon, row.lat, row.lon) <= HOTSPOT_RADIUS_M));
    for (const g of near) groups.splice(groups.indexOf(g), 1);
    groups.push([...near.flat(), row]);
  }
  return groups
    .map((group) => {
      const counts = new Map<string, { count: number; latest: number }>();
      for (const row of group) {
        const seen = counts.get(row.address) ?? { count: 0, latest: 0 };
        counts.set(row.address, { count: seen.count + 1, latest: Math.max(seen.latest, row.created_at) });
      }
      const [address] = [...counts.entries()].sort(
        (a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest,
      )[0];
      return { address, reports: group.length };
    })
    .filter((spot) => spot.reports >= HOTSPOT_MIN_REPORTS)
    .sort((a, b) => b.reports - a.reports)
    .slice(0, HOTSPOT_COUNT);
}

// "dd/mm/yyyy" of the Dublin date becomes the key of daily_stats.
const dayKey = (date: string) => date.split("/").reverse().join("-");

// The nightly count: the statistics of the day before and the new hotspots. Everything is
// written by one batch and repeating it gives the same rows.
// One read of the whole log (2 months of a small district) and one batch of writes.
export async function runNightlyStats(db: D1Database, now: number): Promise<void> {
  const { results } = await db
    .prepare("SELECT address, lat, lon, parking, created_at FROM report_log ORDER BY created_at")
    .all<PlaceRow & { parking: number }>();

  const yesterday = dublinDateTime(now - DAY_MS).date;
  const ofYesterday = results.filter((row) => dublinDateTime(row.created_at).date === yesterday);
  const perOption = PARKING_OPTIONS.map((_, i) => ofYesterday.filter((row) => row.parking & (1 << i)).length);

  await db.batch([
    db
      .prepare(
        `INSERT OR REPLACE INTO daily_stats
         (day, reports, option_0, option_1, option_2, option_3, option_4, option_5, option_6)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(dayKey(yesterday), ofYesterday.length, ...perOption),
    db.prepare("DELETE FROM hotspots"),
    ...topHotspots(results).map((spot, i) =>
      db.prepare("INSERT INTO hotspots (rank, address, reports) VALUES (?1, ?2, ?3)").bind(i + 1, spot.address, spot.reports),
    ),
  ]);
}
