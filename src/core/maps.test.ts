import { beforeEach, describe, expect, it } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { getDirectoryItems, getReportPlaces, mapPeriodDays } from "./maps";

const at = (year: number, month: number, day: number, hour = 12) => Date.UTC(year, month - 1, day, hour);

describe("mapPeriodDays", () => {
  it("gives the days of the four periods", () => {
    const now = at(2026, 5, 15);
    expect(mapPeriodDays("today", now)).toEqual({ from: "2026-05-15", to: "2026-05-15" });
    expect(mapPeriodDays("week", now)).toEqual({ from: "2026-05-08", to: "2026-05-14" });
    expect(mapPeriodDays("last_month", now)).toEqual({ from: "2026-04-15", to: "2026-05-14" });
    expect(mapPeriodDays("month_before", now)).toEqual({ from: "2026-03-15", to: "2026-04-14" });
  });
  it("takes the Dublin day, not the UTC day", () => {
    // 23:30 UTC on 14 May is 00:30 on 15 May in Dublin.
    expect(mapPeriodDays("today", at(2026, 5, 14, 23) + 30 * 60 * 1000)).toEqual({ from: "2026-05-15", to: "2026-05-15" });
  });
  it("uses the last day of a shorter month", () => {
    const now = at(2026, 5, 31);
    expect(mapPeriodDays("last_month", now)).toEqual({ from: "2026-04-30", to: "2026-05-30" });
    expect(mapPeriodDays("month_before", now)).toEqual({ from: "2026-03-31", to: "2026-04-29" });
  });
  it("goes over the end of the year", () => {
    const now = at(2026, 1, 15);
    expect(mapPeriodDays("week", now)).toEqual({ from: "2026-01-08", to: "2026-01-14" });
    expect(mapPeriodDays("last_month", now)).toEqual({ from: "2025-12-15", to: "2026-01-14" });
    expect(mapPeriodDays("month_before", now)).toEqual({ from: "2025-11-15", to: "2025-12-14" });
  });
});

let db: D1Database;
let sqlite: ReturnType<typeof fakeD1>["sqlite"];

const addAddress = (text: string, kind: string, geometry: unknown, lon: number, lat: number): number =>
  Number(
    sqlite
      .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5)")
      .run(text, kind, JSON.stringify(geometry), lon, lat).lastInsertRowid,
  );
const addReport = (plate: string, day: string, createdAt: number, lat: number, lon: number, addressId: number | null) =>
  sqlite
    .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon, address_id) VALUES (?, ?, ?, 1, 'Some Road', ?, ?, ?)")
    .run(createdAt, day, plate, lat, lon, addressId);

beforeEach(() => {
  const fake = fakeD1();
  db = fake.db;
  sqlite = fake.sqlite;
});

describe("getReportPlaces", () => {
  const now = at(2026, 11, 7);

  it("groups the reports of the period by place and gives their dates, the latest first", async () => {
    const shop = addAddress("Shop", "facility", { type: "Point", coordinates: [-6.1, 53.4] }, -6.1, 53.4);
    addReport("AAA111", "2026-11-05", at(2026, 11, 5, 10), 53.40001, -6.10001, shop);
    addReport("BBB222", "2026-11-06", at(2026, 11, 6, 8), 53.4, -6.1, shop);
    addReport("CCC333", "2026-11-06", at(2026, 11, 6, 9), 53.5, -6.2, null);
    addReport("DDD444", "2026-10-01", at(2026, 10, 1, 9), 53.6, -6.3, null);
    const places = await getReportPlaces(db, "week", now);
    expect(places).toHaveLength(2);
    const facility = places.find((place) => place.facility);
    expect(facility).toEqual({ lat: 53.4, lon: -6.1, facility: true, dates: ["06/11/2026", "05/11/2026"] });
    expect(places.find((place) => !place.facility)).toEqual({ lat: 53.5, lon: -6.2, facility: false, dates: ["06/11/2026"] });
  });

  it("puts the reports without a directory address within 20 m into one place, at the first report", async () => {
    addReport("AAA111", "2026-11-06", at(2026, 11, 6, 8), 53.5, -6.2, null);
    addReport("BBB222", "2026-11-06", at(2026, 11, 6, 9), 53.5001, -6.2, null);
    addReport("CCC333", "2026-11-06", at(2026, 11, 6, 10), 53.502, -6.2, null);
    const places = await getReportPlaces(db, "week", now);
    expect(places.map((place) => place.dates.length).sort()).toEqual([1, 2]);
    expect(places.find((place) => place.dates.length === 2)).toMatchObject({ lat: 53.5, lon: -6.2 });
  });

  it("shows a place of a deleted directory address at the coordinates of its first report", async () => {
    addReport("AAA111", "2026-11-06", at(2026, 11, 6, 8), 53.5, -6.2, 999);
    expect(await getReportPlaces(db, "week", now)).toEqual([{ lat: 53.5, lon: -6.2, facility: false, dates: ["06/11/2026"] }]);
  });

  it("takes the day of a row without one from its time", async () => {
    addReport("AAA111", "", at(2026, 11, 6, 9), 53.5, -6.2, null);
    expect(await getReportPlaces(db, "week", now)).toHaveLength(1);
    expect(await getReportPlaces(db, "today", now)).toHaveLength(0);
  });

  it("keeps each period to its own days", async () => {
    addReport("AAA111", "2026-11-07", at(2026, 11, 7, 8), 53.5, -6.2, null);
    addReport("BBB222", "2026-10-20", at(2026, 10, 20, 8), 53.6, -6.2, null);
    addReport("CCC333", "2026-10-05", at(2026, 10, 5, 8), 53.7, -6.2, null);
    expect((await getReportPlaces(db, "today", now)).map((place) => place.lat)).toEqual([53.5]);
    expect((await getReportPlaces(db, "week", now)).map((place) => place.lat)).toEqual([]);
    expect((await getReportPlaces(db, "last_month", now)).map((place) => place.lat)).toEqual([53.6]);
    expect((await getReportPlaces(db, "month_before", now)).map((place) => place.lat)).toEqual([53.7]);
  });

  it("does not give plates", async () => {
    addReport("AAA111", "2026-11-06", at(2026, 11, 6, 8), 53.5, -6.2, null);
    expect(JSON.stringify(await getReportPlaces(db, "week", now))).not.toContain("AAA111");
  });
});

describe("getDirectoryItems", () => {
  it("gives every address with its geometry and leaves out a broken one", async () => {
    const line = { type: "LineString", coordinates: [[-6.1, 53.4], [-6.1, 53.401]] };
    addAddress("Main St", "spot", line, -6.1, 53.4);
    addAddress("Broken", "house", { type: "Point", coordinates: ["x"] }, 0, 0);
    expect(await getDirectoryItems(db)).toEqual([{ text: "Main St", kind: "spot", geometry: line }]);
  });
});
