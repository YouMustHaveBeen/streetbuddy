import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { getHotspots, HOTSPOT_MIN_REPORTS, logReport, runNightlyStats, topHotspots } from "./stats";

const HOUR = 60 * 60 * 1000;
// Around 53.4, -6.1: 0.0001 degrees of latitude are about 11 m.
const row = (address: string, createdAt: number, dLat = 0) => ({
  address,
  lat: 53.4 + dLat,
  lon: -6.1,
  created_at: createdAt,
});

// n rows of one place, one minute apart.
const many = (n: number, address: string, dLat = 0, from = 1) =>
  Array.from({ length: n }, (_, i) => row(address, from + i, dLat));

describe("topHotspots", () => {
  it("counts places within 50 m as one and shows the address that occurs most often", () => {
    const spots = topHotspots([
      row("1 Main Street", 1),
      ...many(HOTSPOT_MIN_REPORTS, "3 Main Street", 0.0002, 2),
    ]);
    expect(spots).toEqual([{ address: "3 Main Street", reports: HOTSPOT_MIN_REPORTS + 1 }]);
  });
  it("shows the latest address when they occur equally often", () => {
    const half = HOTSPOT_MIN_REPORTS / 2;
    const spots = topHotspots([
      ...many(half, "1 Main Street", 0, 1),
      ...many(half, "3 Main Street", 0.0002, 1),
      row("3 Main Street", 50, 0.0002),
      row("1 Main Street", 49),
    ]);
    expect(spots).toEqual([{ address: "3 Main Street", reports: HOTSPOT_MIN_REPORTS + 2 }]);
  });
  it("keeps places farther than 50 m apart, most reports first, five at most", () => {
    const n = HOTSPOT_MIN_REPORTS;
    const rows = [
      ...many(n, "A"),
      ...many(n + 2, "B", 0.002),
      ...many(n, "C", 0.004),
      ...many(n, "D", 0.006),
      ...many(n, "E", 0.008),
      ...many(n, "F", 0.01),
    ];
    const spots = topHotspots(rows);
    expect(spots).toHaveLength(5);
    expect(spots[0]).toEqual({ address: "B", reports: n + 2 });
  });
  it("leaves out places with fewer reports than the minimum", () => {
    const rows = [...many(HOTSPOT_MIN_REPORTS - 1, "Few"), ...many(HOTSPOT_MIN_REPORTS, "Enough", 0.002)];
    expect(topHotspots(rows)).toEqual([{ address: "Enough", reports: HOTSPOT_MIN_REPORTS }]);
  });
  it("gives nothing for an empty log", () => {
    expect(topHotspots([])).toEqual([]);
  });
});

describe("runNightlyStats", () => {
  // 3:00 in Dublin on 15 December 2026 (GMT).
  const NOW = Date.UTC(2026, 11, 15, 3, 0);
  const line = (sqlite: ReturnType<typeof fakeD1>["sqlite"], createdAt: number, parking: number, address = "A") =>
    sqlite
      .prepare("INSERT INTO report_log (created_at, plate, parking, address, lat, lon) VALUES (?, 'p', ?, ?, 53.4, -6.1)")
      .run(createdAt, parking, address);

  it("counts the reports of yesterday in Dublin and how often each option was chosen", async () => {
    const { db, sqlite } = fakeD1();
    line(sqlite, NOW - 25 * HOUR, 1); // 14 December 02:00 - yesterday
    line(sqlite, NOW - 4 * HOUR, 1 | 4); // 14 December 23:00 - yesterday
    line(sqlite, NOW - 30 * 60 * 1000, 2); // today
    line(sqlite, NOW - 50 * HOUR, 64); // the day before yesterday
    await runNightlyStats(db, NOW);
    expect(sqlite.prepare("SELECT * FROM daily_stats").all()).toEqual([
      { day: "2026-12-14", reports: 2, option_0: 2, option_1: 0, option_2: 1, option_3: 0, option_4: 0, option_5: 0, option_6: 0 },
    ]);
  });

  it("replaces the hotspots every night and gives the same rows when repeated", async () => {
    const { db, sqlite } = fakeD1();
    for (let i = 0; i < HOTSPOT_MIN_REPORTS; i++) line(sqlite, NOW - 25 * HOUR + i, 1, "A");
    await runNightlyStats(db, NOW);
    await runNightlyStats(db, NOW);
    expect(await getHotspots(db)).toEqual([{ address: "A", reports: HOTSPOT_MIN_REPORTS }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM daily_stats").get()).toEqual({ n: 1 });
    sqlite.prepare("DELETE FROM report_log").run();
    await runNightlyStats(db, NOW + 24 * HOUR);
    expect(await getHotspots(db)).toEqual([]);
  });

  it("writes a day with no reports as zeros", async () => {
    const { db, sqlite } = fakeD1();
    await runNightlyStats(db, NOW);
    expect(sqlite.prepare("SELECT reports FROM daily_stats").all()).toEqual([{ reports: 0 }]);
  });
});

describe("logReport", () => {
  it("writes one line with no Telegram ID", async () => {
    const { db, sqlite } = fakeD1();
    const id = await logReport(db, { plate: "12-D-3456", parking: 3, address: "A", lat: 53.4, lon: -6.1 });
    const rows = sqlite.prepare("SELECT * FROM report_log").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(Object.keys(rows[0]).sort()).toEqual(["address", "created_at", "id", "lat", "lon", "parking", "plate"]);
  });
});
