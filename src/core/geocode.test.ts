import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { areaBounds, isInArea } from "./area";
import type { Area } from "./area";
import { reverseGeocode, searchAddress } from "./geocode";

const area: Area = {
  county: "Dublin",
  postalDistrict: "D13",
  ring: [
    [-6.17, 53.402],
    [-6.156, 53.402],
    [-6.156, 53.409],
    [-6.17, 53.409],
  ],
};

// Minimal D1 on top of SQLite, running the real migration.
function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0001_geocode_cache.sql", "utf8"));
  const prepare = (sql: string) => {
    const bound = (args: unknown[]) => ({
      first: async () => sqlite.prepare(sql).get(...(args as never[])) ?? null,
      run: async () => sqlite.prepare(sql).run(...(args as never[])),
    });
    return { bind: (...args: unknown[]) => bound(args) };
  };
  return { prepare } as unknown as D1Database;
}

function respondWith(body: unknown, status = 200) {
  const mock = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

const result = (address: Record<string, string>) => ({ lat: "53.405", lon: "-6.16", address });

const defer = (work: Promise<unknown>) => void work;

let db: D1Database;
beforeEach(() => {
  db = fakeD1();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reverseGeocode", () => {
  it("keeps a full Eircode", async () => {
    respondWith(result({ house_number: "12", road: "Main Street", suburb: "Clongriffin", postcode: "d13x1y2" }));
    expect(await reverseGeocode(db, area, 53.405, -6.16, defer)).toBe("12 Main Street, Clongriffin, D13 X1Y2");
  });
  it("falls back to the postal district", async () => {
    respondWith(result({ road: "Main Street", suburb: "Clongriffin", postcode: "Dublin 13" }));
    expect(await reverseGeocode(db, area, 53.405, -6.16, defer)).toBe("Main Street, Clongriffin, D13");
  });
  it("sends the User-Agent and rounded coordinates", async () => {
    const mock = respondWith(result({ road: "Main Street" }));
    await reverseGeocode(db, area, 53.405123, -6.160123, defer);
    const [url, init] = mock.mock.calls[0];
    expect(url.searchParams.get("lat")).toBe("53.4051");
    expect(url.searchParams.get("lon")).toBe("-6.1601");
    expect(init.headers).toEqual({ "User-Agent": "StreetBuddy (t.me/streetbuddy_bot)" });
  });
  it("serves nearby points from the cache", async () => {
    const mock = respondWith(result({ road: "Main Street" }));
    await reverseGeocode(db, area, 53.40512, -6.16012, defer);
    expect(await reverseGeocode(db, area, 53.40514, -6.16014, defer)).toBe("Main Street, D13");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("returns null and caches nothing when Nominatim finds nothing", async () => {
    const mock = respondWith({ error: "Unable to geocode" });
    expect(await reverseGeocode(db, area, 53.405, -6.16, defer)).toBeNull();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2000 });
    await reverseGeocode(db, area, 53.405, -6.16, defer);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("throws when Nominatim fails", async () => {
    respondWith({}, 503);
    await expect(reverseGeocode(db, area, 53.405, -6.16, defer)).rejects.toThrow("503");
  });
  it("keeps one second between requests", async () => {
    const mock = respondWith(result({ road: "Main Street" }));
    const started = Date.now();
    await reverseGeocode(db, area, 53.405, -6.16, defer);
    await reverseGeocode(db, area, 53.406, -6.16, defer);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(990);
  });
});

describe("searchAddress", () => {
  it("searches only inside the rectangle around the district", async () => {
    const mock = respondWith([result({ road: "Main Street" })]);
    const place = await searchAddress(db, area, "  Main   Street ", defer);
    const params = mock.mock.calls[0][0].searchParams;
    const { west, south, east, north } = areaBounds(area);
    expect(params.get("q")).toBe("Main Street");
    expect(params.get("bounded")).toBe("1");
    expect(params.get("countrycodes")).toBe("ie");
    expect(params.get("viewbox")).toBe(`${west},${north},${east},${south}`);
    expect(place).toEqual({ address: "Main Street, D13", lat: 53.405, lon: -6.16 });
  });
  it("ignores case and spacing in the cache", async () => {
    const mock = respondWith([result({ road: "Main Street" })]);
    await searchAddress(db, area, "Main Street", defer);
    await searchAddress(db, area, "main  STREET", defer);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("returns null when nothing is found", async () => {
    respondWith([]);
    expect(await searchAddress(db, area, "Nowhere", defer)).toBeNull();
  });
});

describe("areaBounds", () => {
  it("contains the 50 m margin", () => {
    const { west, north } = areaBounds(area);
    expect(isInArea(area, north - 0.0001, -6.16)).toBe(true);
    expect(isInArea(area, 53.405, west + 0.0001)).toBe(true);
    expect(isInArea(area, north + 0.0001, -6.16)).toBe(false);
  });
});
