import { describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { getHotspots, logReport, runNightlyStats, topHotspots } from "./stats";

const HOUR = 60 * 60 * 1000;
// Around 53.4, -6.1: 0.0001 degrees of latitude are about 11 m.
const row = (address: string, createdAt: number, dLat = 0) => ({
  address,
  lat: 53.4 + dLat,
  lon: -6.1,
  created_at: createdAt,
});

describe("topHotspots", () => {
  it("counts places within 50 m as one and shows the address that occurs most often", () => {
    const spots = topHotspots([
      row("1 Main Street", 1),
      row("3 Main Street", 2, 0.0002),
      row("3 Main Street", 3, 0.0003),
    ]);
    expect(spots).toEqual([{ address: "3 Main Street", reports: 3 }]);
  });
  it("shows the latest address when they occur equally often", () => {
    const spots = topHotspots([row("1 Main Street", 1), row("3 Main Street", 5, 0.0002), row("1 Main Street", 2), row("3 Main Street", 3, 0.0002)]);
    expect(spots).toEqual([{ address: "3 Main Street", reports: 4 }]);
  });
  it("keeps places farther than 50 m apart, most reports first, five at most", () => {
    const rows = [
      row("A", 1),
      row("B", 2, 0.002),
      row("B", 3, 0.002),
      row("C", 4, 0.004),
      row("D", 5, 0.006),
      row("E", 6, 0.008),
      row("F", 7, 0.01),
      row("B", 8, 0.002),
    ];
    const spots = topHotspots(rows);
    expect(spots).toHaveLength(5);
    expect(spots[0]).toEqual({ address: "B", reports: 3 });
  });
  it("gives nothing for an empty log", () => {
    expect(topHotspots([])).toEqual([]);
  });
});

describe("runNightlyStats", () => {
  // 1:00 in Dublin on 15 December 2026 (GMT).
  const NOW = Date.UTC(2026, 11, 15, 1, 0);
  const line = (sqlite: ReturnType<typeof fakeD1>["sqlite"], createdAt: number, parking: number, address = "A") =>
    sqlite
      .prepare("INSERT INTO report_log (created_at, plate, parking, address, lat, lon) VALUES (?, 'p', ?, ?, 53.4, -6.1)")
      .run(createdAt, parking, address);

  it("counts the reports of yesterday in Dublin and how often each option was chosen", async () => {
    const { db, sqlite } = fakeD1();
    line(sqlite, NOW - 25 * HOUR, 1); // 14 December 00:00 - yesterday
    line(sqlite, NOW - 2 * HOUR, 1 | 4); // 14 December 23:00 - yesterday
    line(sqlite, NOW - 30 * 60 * 1000, 2); // today
    line(sqlite, NOW - 50 * HOUR, 64); // the day before yesterday
    await runNightlyStats(db, NOW);
    expect(sqlite.prepare("SELECT * FROM daily_stats").all()).toEqual([
      { day: "2026-12-14", reports: 2, option_0: 2, option_1: 0, option_2: 1, option_3: 0, option_4: 0, option_5: 0, option_6: 0 },
    ]);
  });

  it("replaces the hotspots every night and gives the same rows when repeated", async () => {
    const { db, sqlite } = fakeD1();
    line(sqlite, NOW - 25 * HOUR, 1, "A");
    line(sqlite, NOW - 24 * HOUR, 1, "A");
    await runNightlyStats(db, NOW);
    await runNightlyStats(db, NOW);
    expect(await getHotspots(db)).toEqual([{ address: "A", reports: 2 }]);
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
    await logReport(db, { plate: "12-D-3456", parking: 3, address: "A", lat: 53.4, lon: -6.1 });
    const rows = sqlite.prepare("SELECT * FROM report_log").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["address", "created_at", "id", "lat", "lon", "parking", "plate"]);
  });
});
