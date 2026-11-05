// The report log, the nightly statistics and the hotspots, all in D1.
import { distanceM, M_PER_DEG } from "./area";
import { dublinDateTime, PARKING_OPTIONS } from "./report";
import { DAY_MS, TWO_MONTHS_MS } from "./shared";

// How long a row of the log stays.
export const REPORT_LOG_TTL_MS = TWO_MONTHS_MS;

// Places of the log closer to each other than this count as one place.
const HOTSPOT_RADIUS_M = 50;
const HOTSPOT_COUNT = 5;
// The least number of different plates of a place that is shown.
export const HOTSPOT_MIN_REPORTS = 10;

export interface LoggedReport {
  plate: string;
  parking: number;
  address: string;
  lat: number;
  lon: number;
}

interface Hotspot {
  address: string;
  plates: number;
}

// "dd/mm/yyyy" of the Dublin date becomes the key of daily_stats and of report_log.day.
const dayKey = (date: string) => date.split("/").reverse().join("-");

// One row for every link given; there is no Telegram ID in it. Returns the ID of the row.
export async function logReport(db: D1Database, report: LoggedReport): Promise<number> {
  const now = Date.now();
  const result = await db
    .prepare(
      "INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(now, dayKey(dublinDateTime(now).date), report.plate, report.parking, report.address, report.lat, report.lon)
    .run();
  return result.meta.last_row_id;
}

export async function getHotspots(db: D1Database): Promise<Hotspot[]> {
  const { results } = await db
    .prepare("SELECT address, plates FROM hotspots ORDER BY rank")
    .all<Hotspot>();
  return results;
}

interface PlaceRow {
  plate: string;
  address: string;
  lat: number;
  lon: number;
  created_at: number;
}

// Joins rows within HOTSPOT_RADIUS_M of each other into groups, including chains of close
// points. Rows are put into a grid of cells at least the radius wide, and a row is compared
// only with the rows of its own and the eight neighbouring cells. A group is a tree of row
// numbers, with parent[i] pointing towards its root. Groups come in the order of their last rows.
function groupPlaces(rows: readonly PlaceRow[]): PlaceRow[][] {
  const parent = rows.map((_, i) => i);
  const find = (start: number): number => {
    let i = start;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const latStep = HOTSPOT_RADIUS_M / M_PER_DEG;
  const lonStep = latStep / rows.reduce((least, row) => Math.min(least, Math.cos((row.lat * Math.PI) / 180)), 1);
  const cells = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const x = Math.floor(row.lon / lonStep);
    const y = Math.floor(row.lat / latStep);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of cells.get(`${x + dx},${y + dy}`) ?? []) {
          const near = find(other) !== find(i) && distanceM(rows[other].lat, rows[other].lon, row.lat, row.lon) <= HOTSPOT_RADIUS_M;
          if (near) parent[find(other)] = find(i);
        }
      }
    }
    const key = `${x},${y}`;
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  });

  const groups = new Map<number, { rows: PlaceRow[]; last: number }>();
  rows.forEach((row, i) => {
    const group = groups.get(find(i)) ?? { rows: [], last: i };
    group.rows.push(row);
    group.last = i;
    groups.set(find(i), group);
  });
  return [...groups.values()].sort((a, b) => a.last - b.last).map((group) => group.rows);
}

// Rows are in time order. A group is shown by the address that occurs in it most often, and by
// the latest of those when they are equal; its count is the number of different plates, and
// groups below HOTSPOT_MIN_REPORTS are left out.
export function topHotspots(rows: readonly PlaceRow[]): Hotspot[] {
  return groupPlaces(rows)
    .map((group) => {
      const counts = new Map<string, { count: number; latest: number }>();
      for (const row of group) {
        const seen = counts.get(row.address) ?? { count: 0, latest: 0 };
        counts.set(row.address, { count: seen.count + 1, latest: Math.max(seen.latest, row.created_at) });
      }
      const [address] = [...counts.entries()].sort(
        (a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest,
      )[0];
      return { address, plates: new Set(group.map((row) => row.plate)).size };
    })
    .filter((spot) => spot.plates >= HOTSPOT_MIN_REPORTS)
    .sort((a, b) => b.plates - a.plates)
    .slice(0, HOTSPOT_COUNT);
}

// The nightly count: the statistics of the day before and the new hotspots. One read of the
// whole log and one batch of writes; repeating it gives the same rows.
export async function runNightlyStats(db: D1Database, now: number): Promise<void> {
  const { results } = await db
    .prepare("SELECT plate, address, lat, lon, parking, day, created_at FROM report_log ORDER BY created_at")
    .all<PlaceRow & { parking: number; day: string }>();

  const yesterday = dayKey(dublinDateTime(now - DAY_MS).date);
  const ofYesterday = results.filter((row) => row.day === yesterday);
  const perOption = PARKING_OPTIONS.map((_, i) => ofYesterday.filter((row) => row.parking & (1 << i)).length);

  await db.batch([
    db
      .prepare(
        `INSERT OR REPLACE INTO daily_stats
         (day, reports, option_0, option_1, option_2, option_3, option_4, option_5, option_6)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(yesterday, ofYesterday.length, ...perOption),
    db.prepare("DELETE FROM hotspots"),
    ...topHotspots(results).map((spot, i) =>
      db.prepare("INSERT INTO hotspots (rank, address, plates) VALUES (?1, ?2, ?3)").bind(i + 1, spot.address, spot.plates),
    ),
  ]);
}
