import { beforeEach, describe, expect, it } from "vitest";
import { fakeD1 } from "../test/fakeD1";
import worker from "./index";
import { directoryPage, reportMapPage } from "./maps";
import type { Env } from "./env";

let env: Env;
let sqlite: ReturnType<typeof fakeD1>["sqlite"];

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  env = { DB: fake.db, MAPBOX_TOKEN: "pk.test-token" } as Env;
});

const addAddress = (text: string, kind: string, geometry: unknown) =>
  sqlite
    .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES (?, ?, ?, -6.1, 53.4, -6.1, 53.4)")
    .run(text, kind, JSON.stringify(geometry));

describe("the report map page", () => {
  it("is HTML with the Mapbox map, the token and the places of the period", async () => {
    sqlite
      .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon) VALUES (?, '2026-11-06', 'AAA111', 1, 'Road', 53.5, -6.2)")
      .run(Date.UTC(2026, 10, 6, 9));
    const response = await reportMapPage(env, "week", Date.UTC(2026, 10, 7, 12));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js");
    expect(html).toContain('mapboxgl.accessToken = "pk.test-token"');
    expect(html).toContain('"dates":["06/11/2026"]');
    expect(html).toContain("mapbox://styles/mapbox/streets-v12");
    expect(html).not.toContain("AAA111");
  });

  it("gives no page for a missing or unknown period", async () => {
    expect((await reportMapPage(env, null)).status).toBe(404);
    expect((await reportMapPage(env, "year")).status).toBe(404);
  });

  it("does not use innerHTML", async () => {
    expect(await (await reportMapPage(env, "today")).text()).not.toContain("innerHTML");
  });
});

describe("the directory map page", () => {
  it("is HTML with every address of the directory", async () => {
    addAddress("12 Main St", "house", { type: "Point", coordinates: [-6.1, 53.4] });
    const response = await directoryPage(env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain('"text":"12 Main St","kind":"house"');
    expect(html).toContain('mapboxgl.accessToken = "pk.test-token"');
    expect(html).not.toContain("innerHTML");
  });

  it("cannot be broken out of its script by an address text", async () => {
    addAddress("</script><b>x", "house", { type: "Point", coordinates: [-6.1, 53.4] });
    const html = await (await directoryPage(env)).text();
    expect(html).not.toContain("</script><b>");
    expect(html).toContain("\\u003c/script>");
  });
});

describe("the script of the map pages", () => {
  // The inline script is the last script element of the page.
  const scriptOf = (html: string) => html.split("<script>").at(-1)!.split("</script>")[0];

  it("is valid JavaScript on both pages", async () => {
    addAddress("12 Main St", "house", { type: "Point", coordinates: [-6.1, 53.4] });
    const report = scriptOf(await (await reportMapPage(env, "week")).text());
    const directory = scriptOf(await (await directoryPage(env)).text());
    expect(() => new Function(report)).not.toThrow();
    expect(() => new Function(directory)).not.toThrow();
  });
});

describe("the routes of the map pages", () => {
  const request = (path: string, method = "GET") => worker.fetch(new Request(`https://example.com${path}`, { method }), env, {} as ExecutionContext);

  it("serve /reportmap with a period and /directory", async () => {
    expect((await request("/reportmap?period=today")).status).toBe(200);
    expect((await request("/reportmap?period=today", "HEAD")).status).toBe(200);
    expect((await request("/directory")).status).toBe(200);
  });
  it("give 404 for /reportmap without a known period", async () => {
    expect((await request("/reportmap")).status).toBe(404);
    expect((await request("/reportmap?period=all")).status).toBe(404);
  });
  it("do not answer a POST", async () => {
    expect((await request("/directory", "POST")).status).toBe(404);
  });
});
