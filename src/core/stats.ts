// The report log, the nightly statistics and the hotspots, all in D1.
import { distanceM } from "./area";
import { dublinDateTime, PARKING_OPTIONS } from "./report";
import { DAY_MS } from "./shared";

// How long a row of the log stays.
export const REPORT_LOG_TTL_MS = 66 * DAY_MS;

// A report without a directory address joins the group whose first report is this close.
const HOTSPOT_RADIUS_M = 20;
// The least number of different plates of a place that is shown.
export const HOTSPOT_MIN_REPORTS = 10;

export interface LoggedReport {
  plate: string;
  parking: number;
  address: string;
  lat: number;
  lon: number;
  // The chosen directory address, null for an address from Nominatim or written by the user.
  addressId: number | null;
}

export interface Hotspot {
  address: string;
  plates: number;
  // The directory address of the place, or null.
  addressId: number | null;
  // The first report of the place.
  lat: number;
  lon: number;
}

// "dd/mm/yyyy" of the Dublin date becomes the key of daily_stats and of report_log.day.
const dayKey = (date: string) => date.split("/").reverse().join("-");

// The Dublin date of a moment as yyyy-mm-dd.
export const dublinDay = (timestampMs: number): string => dayKey(dublinDateTime(timestampMs).date);

// One row for every link given; there is no Telegram ID in it. Returns the ID of the row.
export async function logReport(db: D1Database, report: LoggedReport): Promise<number> {
  const now = Date.now();
  const result = await db
    .prepare(
      "INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon, address_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(now, dublinDay(now), report.plate, report.parking, report.address, report.lat, report.lon, report.addressId)
    .run();
  return result.meta.last_row_id;
}

// Every hotspot, the most plates first.
export async function getHotspots(db: D1Database): Promise<Hotspot[]> {
  const { results } = await db
    .prepare("SELECT address, plates, address_id AS addressId, lat, lon FROM hotspots ORDER BY rank")
    .all<Hotspot>();
  return results;
}

// Whether a place with this directory address, or else near these coordinates, is a hotspot.
export function isHotspot(hotspots: readonly Hotspot[], addressId: number | null, lat: number, lon: number): boolean {
  return hotspots.some((spot) =>
    addressId !== null
      ? spot.addressId === addressId
      : spot.addressId === null && distanceM(spot.lat, spot.lon, lat, lon) <= HOTSPOT_RADIUS_M,
  );
}

export interface PlaceRow {
  plate: string;
  address: string;
  lat: number;
  lon: number;
  created_at: number;
  address_id: number | null;
}

// Rows are in time order. Rows with the same directory address make one group. A row without one
// joins the group of rows without one whose first row is nearest, within HOTSPOT_RADIUS_M, or else
// starts a new group with itself as the first row. Groups come in the order of their last rows.
export function groupPlaces<T extends PlaceRow>(rows: readonly T[]): T[][] {
  const byAddress = new Map<number, { rows: T[]; last: number }>();
  const loose: { rows: T[]; last: number }[] = [];
  rows.forEach((row, i) => {
    if (row.address_id !== null) {
      const group = byAddress.get(row.address_id) ?? { rows: [], last: i };
      group.rows.push(row);
      group.last = i;
      byAddress.set(row.address_id, group);
      return;
    }
    let nearest: { rows: T[]; last: number } | null = null;
    let least = Infinity;
    for (const group of loose) {
      const distance = distanceM(group.rows[0].lat, group.rows[0].lon, row.lat, row.lon);
      if (distance <= HOTSPOT_RADIUS_M && distance < least) {
        nearest = group;
        least = distance;
      }
    }
    if (nearest) {
      nearest.rows.push(row);
      nearest.last = i;
    } else {
      loose.push({ rows: [row], last: i });
    }
  });
  return [...byAddress.values(), ...loose].sort((a, b) => a.last - b.last).map((group) => group.rows);
}

// Rows are in time order. A group is shown by the address that occurs in it most often, and by
// the latest of those when they are equal; its count is the number of different plates, and
// groups below HOTSPOT_MIN_REPORTS are left out. The most plates come first.
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
      return {
        address,
        plates: new Set(group.map((row) => row.plate)).size,
        addressId: group[0].address_id,
        lat: group[0].lat,
        lon: group[0].lon,
      };
    })
    .filter((spot) => spot.plates >= HOTSPOT_MIN_REPORTS)
    .sort((a, b) => b.plates - a.plates);
}

// The least number of reports of a plate in the list of repeat plates.
const REPEAT_PLATE_MIN_REPORTS = 5;
// The least time between the first and the last report of a possibly abandoned car.
const ABANDONED_MIN_MS = 33 * DAY_MS;
// All reports of a possibly abandoned car are this close to its first report.
const ABANDONED_RADIUS_M = 50;

export type PlateList = "repeat" | "abandoned";

export interface PlateEntry {
  plate: string;
  reports: number;
  // The times of the first and of the last report.
  first: number;
  last: number;
  // The address of the last report.
  address: string;
}

interface PlateRow {
  plate: string;
  address: string;
  lat: number;
  lon: number;
  created_at: number;
}

// Rows are in time order. One item for every plate; sameSpot tells whether every report of the plate
// is within ABANDONED_RADIUS_M of its first report.
function plateItems(rows: readonly PlateRow[]): { entry: PlateEntry; sameSpot: boolean }[] {
  const byPlate = new Map<string, PlateRow[]>();
  for (const row of rows) {
    const group = byPlate.get(row.plate);
    if (group) group.push(row);
    else byPlate.set(row.plate, [row]);
  }
  return [...byPlate.values()].map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    return {
      entry: { plate: first.plate, reports: group.length, first: first.created_at, last: last.created_at, address: last.address },
      sameSpot: group.every((row) => distanceM(first.lat, first.lon, row.lat, row.lon) <= ABANDONED_RADIUS_M),
    };
  });
}

// Plates with at least REPEAT_PLATE_MIN_REPORTS reports anywhere, the most reports first, then the
// latest report first.
function repeatPlates(rows: readonly PlateRow[]): PlateEntry[] {
  return plateItems(rows)
    .map((item) => item.entry)
    .filter((entry) => entry.reports >= REPEAT_PLATE_MIN_REPORTS)
    .sort((a, b) => b.reports - a.reports || b.last - a.last);
}

// Plates whose reports are all at one spot and span at least ABANDONED_MIN_MS from the first to the
// last, the longest span first.
function abandonedPlates(rows: readonly PlateRow[]): PlateEntry[] {
  return plateItems(rows)
    .filter((item) => item.sameSpot && item.entry.last - item.entry.first >= ABANDONED_MIN_MS)
    .map((item) => item.entry)
    .sort((a, b) => b.last - b.first - (a.last - a.first) || a.plate.localeCompare(b.plate));
}

// The plates of one of the lists of /admin, from one read of the log of the last REPORT_LOG_TTL_MS.
export async function listPlates(db: D1Database, list: PlateList, now: number): Promise<PlateEntry[]> {
  const { results } = await db
    .prepare("SELECT plate, address, lat, lon, created_at FROM report_log WHERE created_at > ?1 ORDER BY created_at, id")
    .bind(now - REPORT_LOG_TTL_MS)
    .all<PlateRow>();
  return (list === "repeat" ? repeatPlates : abandonedPlates)(results);
}

// The events the bot counts while it works, one number per event and day.
export const STAT_EVENTS = [
  "started",
  "area_refused",
  "plate_as_is",
  "plate_edited",
  "plate_manual",
  "recognitions",
  "ai_errors",
  "nominatim_errors",
  "outsiders",
] as const;

export type StatEvent = (typeof STAT_EVENTS)[number];

// Adds one to the count of the event for today in Dublin. A failure is only logged.
export async function countEvent(db: D1Database, event: StatEvent): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO daily_counts (day, event, n) VALUES (?1, ?2, 1) ON CONFLICT (day, event) DO UPDATE SET n = n + 1")
      .bind(dublinDay(Date.now()), event)
      .run();
  } catch {
    console.error("Counting an event failed");
  }
}

// How many days the month column of the statistics covers, ending with yesterday.
export const STATISTICS_MONTH_DAYS = 30;

// A number for yesterday, for the last STATISTICS_MONTH_DAYS days up to yesterday, and for all days up to yesterday.
export interface Count {
  yesterday: number;
  month: number;
  all: number;
}

export interface Statistics {
  links: Count;
  options: Count[];
  events: Record<StatEvent, Count>;
  // Different users of yesterday, and of the last STATISTICS_MONTH_DAYS days up to now.
  usersYesterday: number;
  usersMonth: number;
}

const OPTION_COLUMNS = PARKING_OPTIONS.map((_, i) => `option_${i}`);

// The sums of one column over the three periods; ?1 is yesterday and ?2 the first day of the month column.
const periodSums = (column: string, alias: string) =>
  `COALESCE(SUM(CASE WHEN day = ?1 THEN ${column} ELSE 0 END), 0) AS ${alias}_yesterday,
   COALESCE(SUM(CASE WHEN day >= ?2 THEN ${column} ELSE 0 END), 0) AS ${alias}_month,
   COALESCE(SUM(${column}), 0) AS ${alias}_all`;

// The statistics screen: the nightly numbers of daily_stats, the counts of daily_counts and the
// users of the last days. One batch, one round trip.
export async function readStatistics(db: D1Database, now: number): Promise<Statistics> {
  const yesterday = dublinDay(now - DAY_MS);
  const monthStart = dublinDay(now - STATISTICS_MONTH_DAYS * DAY_MS);
  const [counts, stats, users] = await db.batch([
    db
      .prepare(
        `SELECT event, ${periodSums("n", "n")} FROM daily_counts WHERE day <= ?1 GROUP BY event`,
      )
      .bind(yesterday, monthStart),
    db
      .prepare(
        `SELECT ${periodSums("reports", "links")},
                ${OPTION_COLUMNS.map((column, i) => periodSums(column, `o${i}`)).join(",\n")},
                COALESCE(SUM(CASE WHEN day = ?1 THEN users ELSE 0 END), 0) AS users_yesterday
         FROM daily_stats WHERE day <= ?1`,
      )
      .bind(yesterday, monthStart),
    db.prepare("SELECT COUNT(*) AS n FROM user_phones WHERE last_used_at > ?1").bind(now - STATISTICS_MONTH_DAYS * DAY_MS),
  ]);

  const count = (row: Record<string, number>, alias: string): Count => ({
    yesterday: row[`${alias}_yesterday`],
    month: row[`${alias}_month`],
    all: row[`${alias}_all`],
  });
  const eventRows = new Map(
    (counts.results as ({ event: string } & Record<string, number>)[]).map((row) => [row.event, row] as const),
  );
  const [statRow] = stats.results as Record<string, number>[];
  return {
    links: count(statRow, "links"),
    options: PARKING_OPTIONS.map((_, i) => count(statRow, `o${i}`)),
    events: Object.fromEntries(
      STAT_EVENTS.map((event) => {
        const row = eventRows.get(event);
        return [event, row ? count(row, "n") : { yesterday: 0, month: 0, all: 0 }];
      }),
    ) as Record<StatEvent, Count>,
    usersYesterday: statRow.users_yesterday,
    usersMonth: (users.results as { n: number }[])[0].n,
  };
}

// The nightly count: the statistics of the day before and the new hotspots. One read of the
// whole log, one read of the users and one batch of writes; repeating it gives the same rows.
export async function runNightlyStats(db: D1Database, now: number): Promise<void> {
  const [{ results }, phones] = await Promise.all([
    db
      .prepare("SELECT plate, address, lat, lon, address_id, parking, day, created_at FROM report_log ORDER BY created_at")
      .all<PlaceRow & { parking: number; day: string }>(),
    db.prepare("SELECT last_used_at FROM user_phones").all<{ last_used_at: number }>(),
  ]);

  const yesterday = dublinDay(now - DAY_MS);
  // A row written between the migration and the deploy has no day yet.
  const ofYesterday = results.filter((row) => (row.day || dublinDay(row.created_at)) === yesterday);
  const perOption = PARKING_OPTIONS.map((_, i) => ofYesterday.filter((row) => row.parking & (1 << i)).length);
  const users = phones.results.filter((row) => dublinDay(row.last_used_at) === yesterday).length;

  await db.batch([
    db
      .prepare(
        `INSERT OR REPLACE INTO daily_stats
         (day, reports, option_0, option_1, option_2, option_3, option_4, option_5, option_6, users)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(yesterday, ofYesterday.length, ...perOption, users),
    db.prepare("DELETE FROM hotspots"),
    ...topHotspots(results).map((spot, i) =>
      db
        .prepare("INSERT INTO hotspots (rank, address, plates, address_id, lat, lon) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(i + 1, spot.address, spot.plates, spot.addressId, spot.lat, spot.lon),
    ),
  ]);
}
