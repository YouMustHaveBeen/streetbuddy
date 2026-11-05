import { describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { distanceM, M_PER_DEG } from "./area";
import { getHotspots, groupPlaces, HOTSPOT_MIN_REPORTS, logReport, runNightlyStats, topHotspots } from "./stats";

const HOUR = 60 * 60 * 1000;
// Around 53.4, -6.1: 0.0001 degrees of latitude are about 11 m.
// Every row has a plate of its own unless one is given.
let plateNumber = 0;
const row = (address: string, createdAt: number, dLat = 0, plate = `P${++plateNumber}`) => ({
  plate,
  address,
  lat: 53.4 + dLat,
  lon: -6.1,
  created_at: createdAt,
});

// n rows of one place, one minute apart.
const many = (n: number, address: string, dLat = 0, from = 1) =>
  Array.from({ length: n }, (_, i) => row(address, from + i, dLat));

// A simple generator with a fixed start, so that the tests repeat.
const seeded = (start: number) => {
  let state = start;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

type Located = { lat: number; lon: number; created_at: number };

// The way places were grouped before the grid: every row against every group.
function groupsByFullComparison<T extends Located>(rows: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const point of rows) {
    const near = groups.filter((g) => g.some((r) => distanceM(r.lat, r.lon, point.lat, point.lon) <= 50));
    for (const g of near) groups.splice(groups.indexOf(g), 1);
    groups.push([...near.flat(), point]);
  }
  return groups;
}

// The groups as lists of row numbers.
const compositions = (groups: Located[][]) => groups.map((g) => g.map((r) => r.created_at).sort((a, b) => a - b));

describe("topHotspots", () => {
  it("counts places within 50 m as one and shows the address that occurs most often", () => {
    const spots = topHotspots([
      row("1 Main Street", 1),
      ...many(HOTSPOT_MIN_REPORTS, "3 Main Street", 0.0002, 2),
    ]);
    expect(spots).toEqual([{ address: "3 Main Street", plates: HOTSPOT_MIN_REPORTS + 1 }]);
  });
  it("shows the latest address when they occur equally often", () => {
    const half = HOTSPOT_MIN_REPORTS / 2;
    const spots = topHotspots([
      ...many(half, "1 Main Street", 0, 1),
      ...many(half, "3 Main Street", 0.0002, 1),
      row("3 Main Street", 50, 0.0002),
      row("1 Main Street", 49),
    ]);
    expect(spots).toEqual([{ address: "3 Main Street", plates: HOTSPOT_MIN_REPORTS + 2 }]);
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
    expect(spots[0]).toEqual({ address: "B", plates: n + 2 });
  });
  it("joins a chain of points, each within 50 m of the next, into one place", () => {
    const n = HOTSPOT_MIN_REPORTS;
    const rows = [...many(n / 2, "A"), ...many(n / 2, "C", 0.0008), ...many(n / 2, "B", 0.0004)];
    expect(topHotspots(rows)).toEqual([{ address: "A", plates: n / 2 * 3 }]);
  });
  it("counts different plates, so one plate reported again and again stays out", () => {
    const same = Array.from({ length: HOTSPOT_MIN_REPORTS }, (_, i) => row("Same", i + 1, 0, "12-D-1"));
    expect(topHotspots(same)).toEqual([]);
    const different = [...same, ...many(HOTSPOT_MIN_REPORTS - 1, "Same")];
    expect(topHotspots(different)).toEqual([{ address: "Same", plates: HOTSPOT_MIN_REPORTS }]);
  });
  it("leaves out places with fewer reports than the minimum", () => {
    const rows = [...many(HOTSPOT_MIN_REPORTS - 1, "Few"), ...many(HOTSPOT_MIN_REPORTS, "Enough", 0.002)];
    expect(topHotspots(rows)).toEqual([{ address: "Enough", plates: HOTSPOT_MIN_REPORTS }]);
  });
  it("gives the same address and count for every place of clustered data", () => {
    const rnd = seeded(11);
    const rows: ReturnType<typeof row>[] = [];
    // Ten places 1 km apart, each with a minority address; the place with the number c has 10 + 3c plates.
    for (let c = 0; c < 10; c++) {
      for (let i = 0; i < 10 + 3 * c; i++) {
        rows.push({
          plate: `C${c}-${i}`,
          address: i % 5 === 4 ? `Other ${c}` : `Place ${c}`,
          lat: 53.4 + c * 0.009 + rnd() * 0.00015,
          lon: -6.15 + c * 0.015 + rnd() * 0.0002,
          created_at: rows.length + 1,
        });
      }
    }
    const order = seeded(5);
    const mixed = rows.map((r) => ({ ...r, key: order() })).sort((a, b) => a.key - b.key).map(({ key, ...r }, i) => ({ ...r, created_at: i + 1 }));
    expect(topHotspots(mixed)).toEqual([
      { address: "Place 9", plates: 37 },
      { address: "Place 8", plates: 34 },
      { address: "Place 7", plates: 31 },
      { address: "Place 6", plates: 28 },
      { address: "Place 5", plates: 25 },
    ]);
  });
  it("puts rows into the same groups as comparing every row with every other", () => {
    for (const [seed, count, latSpan, lonSpan] of [[1, 500, 0.004, 0.006], [2, 600, 0.002, 0.003], [3, 300, 0.01, 0.02]]) {
      const rnd = seeded(seed);
      const rows = Array.from({ length: count }, (_, i) => ({
        plate: `P${i}`,
        address: "A",
        lat: 53.4 + rnd() * latSpan,
        lon: -6.15 + rnd() * lonSpan,
        created_at: i + 1,
      }));
      expect(compositions(groupPlaces(rows))).toEqual(compositions(groupsByFullComparison(rows)));
    }
  });
  it("joins two rows 49.9 m apart and keeps two rows 50.1 m apart apart, in any direction and across cell borders", () => {
    const latStep = 50 / M_PER_DEG;
    const cosLat = Math.cos((53.4 * Math.PI) / 180);
    const edge = Math.ceil(53.4 / latStep) * latStep - 1e-9;
    for (const [distance, groups] of [[49.9, 1], [50.1, 2]]) {
      const pairs = [
        [{ lat: 53.4, lon: -6.1 }, { lat: 53.4 + distance / M_PER_DEG, lon: -6.1 }],
        [{ lat: 53.4, lon: -6.1 }, { lat: 53.4, lon: -6.1 + distance / (M_PER_DEG * cosLat) }],
        [{ lat: edge, lon: -6.1 }, { lat: edge + distance / M_PER_DEG, lon: -6.1 }],
        [{ lat: 53.4, lon: -6.1 }, { lat: 53.4 - distance / M_PER_DEG, lon: -6.1 }],
      ];
      for (const [a, b] of pairs) {
        const rows = [a, b].map((p, i) => ({ plate: `P${i}`, address: "A", ...p, created_at: i + 1 }));
        expect(groupPlaces(rows)).toHaveLength(groups);
      }
    }
  });
  it("gives nothing for an empty log", () => {
    expect(topHotspots([])).toEqual([]);
  });
});

describe("runNightlyStats", () => {
  // 3:00 in Dublin on 15 December 2026 (GMT).
  const NOW = Date.UTC(2026, 11, 15, 3, 0);
  const line = (sqlite: ReturnType<typeof fakeD1>["sqlite"], createdAt: number, day: string, parking: number, address = "A") =>
    sqlite
      .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon) VALUES (?, ?, ?, ?, ?, 53.4, -6.1)")
      .run(createdAt, day, `P${createdAt}`, parking, address);

  it("counts the reports of yesterday in Dublin and how often each option was chosen", async () => {
    const { db, sqlite } = fakeD1();
    line(sqlite, NOW - 25 * HOUR, "2026-12-14", 1); // 14 December 02:00 - yesterday
    line(sqlite, NOW - 4 * HOUR, "2026-12-14", 1 | 4); // 14 December 23:00 - yesterday
    line(sqlite, NOW - 30 * 60 * 1000, "2026-12-15", 2); // today
    line(sqlite, NOW - 50 * HOUR, "2026-12-13", 64); // the day before yesterday
    line(sqlite, NOW - 90 * 60 * 1000, "2026-12-14", 8); // stored day wins over the time
    await runNightlyStats(db, NOW);
    expect(sqlite.prepare("SELECT * FROM daily_stats").all()).toEqual([
      { day: "2026-12-14", reports: 3, option_0: 2, option_1: 0, option_2: 1, option_3: 1, option_4: 0, option_5: 0, option_6: 0 },
    ]);
  });

  it("replaces the hotspots every night and gives the same rows when repeated", async () => {
    const { db, sqlite } = fakeD1();
    for (let i = 0; i < HOTSPOT_MIN_REPORTS; i++) line(sqlite, NOW - 25 * HOUR + i, "2026-12-14", 1, "A");
    await runNightlyStats(db, NOW);
    await runNightlyStats(db, NOW);
    expect(await getHotspots(db)).toEqual([{ address: "A", plates: HOTSPOT_MIN_REPORTS }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM daily_stats").get()).toEqual({ n: 1 });
    sqlite.prepare("DELETE FROM report_log").run();
    await runNightlyStats(db, NOW + 24 * HOUR);
    expect(await getHotspots(db)).toEqual([]);
  });

  it("counts a row that has no day yet by its time", async () => {
    const { db, sqlite } = fakeD1();
    line(sqlite, NOW - 4 * HOUR, "2026-12-14", 1);
    sqlite
      .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon) VALUES (?, '', 'P', 2, 'A', 53.4, -6.1)")
      .run(NOW - 5 * HOUR);
    await runNightlyStats(db, NOW);
    expect(sqlite.prepare("SELECT reports, option_0, option_1 FROM daily_stats").all()).toEqual([
      { reports: 2, option_0: 1, option_1: 1 },
    ]);
  });

  it("writes a day with no reports as zeros", async () => {
    const { db, sqlite } = fakeD1();
    await runNightlyStats(db, NOW);
    expect(sqlite.prepare("SELECT reports FROM daily_stats").all()).toEqual([{ reports: 0 }]);
  });
});

describe("logReport", () => {
  it("stores the Dublin date of the moment, also when it is already the next day there", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 6, 15, 23, 30)); // 00:30 on 16 July in Dublin (summer time)
    try {
      const { db, sqlite } = fakeD1();
      await logReport(db, { plate: "12-D-3456", parking: 1, address: "A", lat: 53.4, lon: -6.1 });
      expect(sqlite.prepare("SELECT day FROM report_log").all()).toEqual([{ day: "2026-07-16" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes one line with no Telegram ID", async () => {
    const { db, sqlite } = fakeD1();
    const id = await logReport(db, { plate: "12-D-3456", parking: 3, address: "A", lat: 53.4, lon: -6.1 });
    const rows = sqlite.prepare("SELECT * FROM report_log").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(Object.keys(rows[0]).sort()).toEqual(["address", "created_at", "day", "id", "lat", "lon", "parking", "plate"]);
  });
});
