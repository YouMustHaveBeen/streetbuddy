import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area } from "./area";
import { formAddress, reverseGeocode, withoutPostalDistrict } from "./geocode";

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

const deferred: Promise<unknown>[] = [];
const defer = (work: Promise<unknown>) => void deferred.push(work);

let db: D1Database;

// The cache write goes on in the background, so each call waits for it.
async function reverse(lat: number, lon: number) {
  try {
    return await reverseGeocode(db, lat, lon, defer);
  } finally {
    await Promise.all(deferred.splice(0));
  }
}
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
    expect(await reverse(53.405, -6.16)).toBe("12 Main Street, Clongriffin, D13 X1Y2");
  });
  it("leaves out anything but a full Eircode, and does not add the postal district", async () => {
    respondWith(result({ road: "Main Street", suburb: "Clongriffin", postcode: "Dublin 13" }));
    expect(await reverse(53.405, -6.16)).toBe("Main Street, Clongriffin");
  });
  it("sends the User-Agent and rounded coordinates", async () => {
    const mock = respondWith(result({ road: "Main Street" }));
    await reverse(53.405123, -6.160123);
    const [url, init] = mock.mock.calls[0];
    expect(url.searchParams.get("lat")).toBe("53.4051");
    expect(url.searchParams.get("lon")).toBe("-6.1601");
    expect(init.headers).toEqual({ "User-Agent": "StreetBuddy (t.me/streetbuddy_bot)" });
  });
  it("serves nearby points from the cache", async () => {
    const mock = respondWith(result({ road: "Main Street" }));
    await reverse(53.40512, -6.16012);
    expect(await reverse(53.40514, -6.16014)).toBe("Main Street");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("returns null when the result has no street, house or locality", async () => {
    respondWith(result({ waterway: "Mayne River" }));
    expect(await reverse(53.405, -6.16)).toBeNull();
  });
  it("returns null and caches nothing when Nominatim finds nothing", async () => {
    const mock = respondWith({ error: "Unable to geocode" });
    expect(await reverse(53.405, -6.16)).toBeNull();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2000 });
    await reverse(53.405, -6.16);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("throws when Nominatim fails", async () => {
    respondWith({}, 503);
    await expect(reverse(53.405, -6.16)).rejects.toThrow("503");
  });
  it("keeps one second between requests", async () => {
    const mock = respondWith(result({ road: "Main Street" }));
    const started = Date.now();
    await reverse(53.405, -6.16);
    await reverse(53.406, -6.16);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(990);
  });
});

describe("formAddress", () => {
  it("adds the postal district only when there is no Eircode", () => {
    expect(formAddress("1 Parkside Drive", area)).toBe("1 Parkside Drive, D13");
    expect(formAddress("12 Main Street, Clongriffin, D13 X1Y2", area)).toBe("12 Main Street, Clongriffin, D13 X1Y2");
    expect(formAddress("12 Main Street D13X1Y2", area)).toBe("12 Main Street D13X1Y2");
    expect(formAddress("12 Main Street d13x1y2", area)).toBe("12 Main Street d13x1y2");
  });
});

describe("withoutPostalDistrict", () => {
  it("takes the postal district off the end, in any case, and leaves the rest", () => {
    expect(withoutPostalDistrict("5 New Street, D13", area)).toBe("5 New Street");
    expect(withoutPostalDistrict("5 New Street d13 ", area)).toBe("5 New Street");
    expect(withoutPostalDistrict("D13 Cafe, Main Street", area)).toBe("D13 Cafe, Main Street");
    expect(withoutPostalDistrict("5 New Street, D13 X1Y2", area)).toBe("5 New Street, D13 X1Y2");
    expect(withoutPostalDistrict("D13", area)).toBe("D13");
  });
});
