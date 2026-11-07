import { describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { M_PER_DEG } from "./area";
import { getHotspots, groupPlaces, HOTSPOT_MIN_REPORTS, logReport, runNightlyStats, topHotspots } from "./stats";

const HOUR = 60 * 60 * 1000;
// Around 53.4, -6.1: 0.0001 degrees of latitude are about 11 m.
// Every row has a plate of its own unless one is given; addressId is the directory address.
let plateNumber = 0;
const row = (address: string, createdAt: number, dLat = 0, plate = `P${++plateNumber}`, addressId: number | null = null) => ({
  plate,
  address,
  lat: 53.4 + dLat,
  lon: -6.1,
  created_at: createdAt,
  address_id: addressId,
});

// n rows of one place, one minute apart.
const many = (n: number, address: string, dLat = 0, from = 1, addressId: number | null = null) =>
  Array.from({ length: n }, (_, i) => row(address, from + i, dLat, undefined, addressId));

describe("topHotspots", () => {
  it("counts places within 20 m of the first report as one and shows the address that occurs most often", () => {
    const spots = topHotspots([row("1 Main Street", 1), ...many(HOTSPOT_MIN_REPORTS, "3 Main Street", 0.00015, 2)]);
    expect(spots).toEqual([{ address: "3 Main Street", plates: HOTSPOT_MIN_REPORTS + 1, addressId: null, lat: 53.4, lon: -6.1 }]);
  });
  it("shows the latest address when they occur equally often", () => {
    const half = HOTSPOT_MIN_REPORTS / 2;
    const spots = topHotspots([
      ...many(half, "1 Main Street", 0, 1),
      ...many(half, "3 Main Street", 0.00015, 10),
      row("3 Main Street", 50, 0.00015),
      row("1 Main Street", 49),
    ]);
    expect(spots).toEqual([{ address: "3 Main Street", plates: HOTSPOT_MIN_REPORTS + 2, addressId: null, lat: 53.4, lon: -6.1 }]);
  });
  it("keeps all places farther than 20 m apart, most plates first", () => {
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
    expect(spots).toHaveLength(6);
    expect(spots[0]).toEqual({ address: "B", plates: n + 2, addressId: null, lat: 53.4 + 0.002, lon: -6.1 });
  });
  it("does not join a chain: a report farther than 20 m from the first one opens a new place", () => {
    // 0.00015 degrees are about 17 m: B is near A, C is near B but not near A.
    const groups = groupPlaces([row("A", 1), row("B", 2, 0.00015), row("C", 3, 0.0003)]);
    expect(groups.map((group) => group.map((r) => r.address))).toEqual([["A", "B"], ["C"]]);
  });
  it("puts a report into the group with the nearest first report", () => {
    const groups = groupPlaces([row("A", 1), row("B", 2, 0.0003), row("C", 3, 0.00017)]);
    expect(groups.map((group) => group.map((r) => r.address))).toEqual([["A"], ["B", "C"]]);
  });
  it("joins two rows 19.9 m apart and keeps two rows 20.1 m apart apart", () => {
    for (const [distance, groups] of [[19.9, 1], [20.1, 2]]) {
      const rows = [row("A", 1), row("A", 2, distance / M_PER_DEG)];
      expect(groupPlaces(rows)).toHaveLength(groups);
    }
  });
  it("counts reports with one directory address as one place, wherever they are, and two addresses as two", () => {
    const n = HOTSPOT_MIN_REPORTS;
    const rows = [
      ...Array.from({ length: n }, (_, i) => row("Parkside Square, D13", i + 1, i * 0.0001, undefined, 7)),
      ...many(n, "1 Parkside Drive, D13", 0, 100, 8),
      ...many(n, "3 Parkside Drive, D13", 0, 200, 9),
    ];
    expect(topHotspots(rows)).toEqual([
      { address: "Parkside Square, D13", plates: n, addressId: 7, lat: 53.4, lon: -6.1 },
      { address: "1 Parkside Drive, D13", plates: n, addressId: 8, lat: 53.4, lon: -6.1 },
      { address: "3 Parkside Drive, D13", plates: n, addressId: 9, lat: 53.4, lon: -6.1 },
    ]);
  });
  it("keeps a report without a directory address out of the place of a directory address at the same spot", () => {
    const groups = groupPlaces([row("A", 1, 0, undefined, 7), row("A", 2)]);
    expect(groups).toHaveLength(2);
  });
  it("counts different plates, so one plate reported again and again stays out", () => {
    const same = Array.from({ length: HOTSPOT_MIN_REPORTS }, (_, i) => row("Same", i + 1, 0, "12-D-1"));
    expect(topHotspots(same)).toEqual([]);
    const different = [...same, ...many(HOTSPOT_MIN_REPORTS - 1, "Same")];
    expect(topHotspots(different)).toEqual([{ address: "Same", plates: HOTSPOT_MIN_REPORTS, addressId: null, lat: 53.4, lon: -6.1 }]);
  });
  it("leaves out places with fewer reports than the minimum, also of a directory address", () => {
    const rows = [
      ...many(HOTSPOT_MIN_REPORTS - 1, "Few", 0, 1, 3),
      ...many(HOTSPOT_MIN_REPORTS, "Enough", 0.002),
    ];
    expect(topHotspots(rows)).toEqual([{ address: "Enough", plates: HOTSPOT_MIN_REPORTS, addressId: null, lat: 53.4 + 0.002, lon: -6.1 }]);
  });
  it("gives the directory address of a place, or else the coordinates of its first report", () => {
    const n = HOTSPOT_MIN_REPORTS;
    const spots = topHotspots([...many(n, "Loose", 0.002), ...many(n, "Listed", 0, 100, 5)]);
    expect(spots).toEqual(
      expect.arrayContaining([
        { address: "Loose", plates: n, addressId: null, lat: 53.402, lon: -6.1 },
        { address: "Listed", plates: n, addressId: 5, lat: 53.4, lon: -6.1 },
      ]),
    );
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
    expect(await getHotspots(db)).toEqual([{ address: "A", plates: HOTSPOT_MIN_REPORTS, addressId: null, lat: 53.4, lon: -6.1 }]);
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

  it("counts the reports of one directory address as one place", async () => {
    const { db, sqlite } = fakeD1();
    for (let i = 0; i < HOTSPOT_MIN_REPORTS; i++) {
      sqlite
        .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon, address_id) VALUES (?, '2026-12-14', ?, 1, 'Square', ?, -6.1, 4)")
        .run(NOW - 25 * HOUR + i, `P${i}`, 53.4 + i * 0.001);
    }
    await runNightlyStats(db, NOW);
    expect(await getHotspots(db)).toEqual([{ address: "Square", plates: HOTSPOT_MIN_REPORTS, addressId: 4, lat: 53.4, lon: -6.1 }]);
  });

  it("stores every place with enough plates, the most plates first", async () => {
    const { db, sqlite } = fakeD1();
    const add = (place: string, lat: number, count: number) => {
      for (let i = 0; i < count; i++) {
        sqlite
          .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon) VALUES (?, '2026-12-14', ?, 1, ?, ?, -6.1)")
          .run(NOW - 25 * HOUR + i, `${place}${i}`, place, lat);
      }
    };
    for (let k = 0; k < 7; k++) add(`Place${k}`, 53.4 + k * 0.01, HOTSPOT_MIN_REPORTS + (k % 3));
    await runNightlyStats(db, NOW);
    const spots = await getHotspots(db);
    expect(spots).toHaveLength(7);
    expect(spots.map((spot) => spot.plates)).toEqual([...spots.map((spot) => spot.plates)].sort((a, b) => b - a));
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
      await logReport(db, { plate: "12-D-3456", parking: 1, address: "A", lat: 53.4, lon: -6.1, addressId: null });
      expect(sqlite.prepare("SELECT day FROM report_log").all()).toEqual([{ day: "2026-07-16" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes one line with no Telegram ID", async () => {
    const { db, sqlite } = fakeD1();
    const id = await logReport(db, { plate: "12-D-3456", parking: 3, address: "A", lat: 53.4, lon: -6.1, addressId: 5 });
    const rows = sqlite.prepare("SELECT * FROM report_log").all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].address_id).toBe(5);
    expect(Object.keys(rows[0]).sort()).toEqual(["address", "address_id", "created_at", "day", "id", "lat", "lon", "parking", "plate"]);
  });
});
