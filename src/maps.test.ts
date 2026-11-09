import { beforeEach, describe, expect, it } from "vitest";
import { fakeD1 } from "../test/fakeD1";
import { DIRECTORY_LINK_TTL_MS, directoryLink } from "./directoryLink";
import worker from "./index";
import { directoryPage, reportMapPage } from "./maps";
import type { Env } from "./env";

let env: Env;
let sqlite: ReturnType<typeof fakeD1>["sqlite"];

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  env = { DB: fake.db, MAPBOX_TOKEN: "pk.test-token", SITE_URL: "https://example.com", DIRECTORY_LINK_SECRET: "link-secret" } as Env;
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

  it("marks a hotspot place with the fire in the circle", async () => {
    const html = await (await reportMapPage(env, "week")).text();
    expect(html).toContain('(place.hotspot ? "🔥" : "")');
  });

  it("gives no page for a missing or unknown period", async () => {
    expect((await reportMapPage(env, null)).status).toBe(404);
    expect((await reportMapPage(env, "year")).status).toBe(404);
  });

  it("does not use innerHTML", async () => {
    expect(await (await reportMapPage(env, "today")).text()).not.toContain("innerHTML");
  });

  it("shows the full street names on both map pages", async () => {
    const label = 'map.setLayoutProperty("road-label", "text-field", ["coalesce", ["get", "name"], ["get", "name_en"]]);';
    expect(await (await reportMapPage(env, "week")).text()).toContain(label);
    expect(await (await directoryPage(env)).text()).toContain(label);
  });
});

describe("the directory map page", () => {
  it("is HTML with every address of the directory", async () => {
    addAddress("12 Main St", "house", { type: "Point", coordinates: [-6.1, 53.4] });
    addAddress("Main Road", "spot", { type: "LineString", coordinates: [[-6.1, 53.4], [-6.1, 53.401]] });
    const response = await directoryPage(env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain('"text":"12 Main St","kind":"house"');
    expect(html).toContain('"text":"Main Road","kind":"spot"');
    expect(html).toContain('mapboxgl.accessToken = "pk.test-token"');
    expect(html).not.toContain("innerHTML");
  });

  it("draws the points of every source violet, and the facility ones fuchsia", async () => {
    addAddress("12 Main St", "house", { type: "Point", coordinates: [-6.1, 53.4] });
    sqlite.prepare("UPDATE addresses SET source = 'osm'").run();
    const html = await (await directoryPage(env)).text();
    expect(html).toContain('"circle-color": ["case", ["==", ["get", "kind"], "facility"], FUCHSIA, VIOLET]');
    expect(html).toContain('FUCHSIA = "#d946ef"');
    expect(html).not.toContain("WHITE");
    expect(html).not.toContain("#ffffff");
  });

  it("shows only the address text in the popup and draws lines and areas violet", async () => {
    addAddress("12 Main St", "house", { type: "Point", coordinates: [-6.1, 53.4] });
    const html = await (await directoryPage(env)).text();
    expect(html).toContain("textNode([properties.text])");
    expect(html).not.toContain("properties.kind");
    expect(html).toContain('"fill-color": VIOLET');
    expect(html).toContain('addLine("lines", "directory", isLine, 4, ["case", ["==", ["get", "kind"], "facility"], FUCHSIA, VIOLET]);');
  });

  it("labels the facility points from zoom 16 and keeps the popup", async () => {
    addAddress("Little Rainbows", "facility", { type: "Point", coordinates: [-6.1, 53.4] });
    const html = await (await directoryPage(env)).text();
    expect(html).toContain('"text":"Little Rainbows","kind":"facility"');
    expect(html).toContain('id: "facility-labels", type: "symbol", source: "directory", minzoom: 16');
    expect(html).toContain('filter: ["all", isPoint, ["==", ["get", "kind"], "facility"]]');
    expect(html).toContain('"text-field": ["get", "text"]');
    expect(html).toContain('"text-color": FUCHSIA');
    expect(html).toContain('["areas", "lines-edge", "points", "facility-labels"].forEach');
    expect(html).toContain("textNode([properties.text])");
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

  const signedPath = async (now = Date.now()) => (await directoryLink(env, now)).replace("https://example.com", "");

  it("serve /reportmap with a period and /directory with a signed link", async () => {
    expect((await request("/reportmap?period=today")).status).toBe(200);
    expect((await request("/reportmap?period=today", "HEAD")).status).toBe(200);
    expect((await request(await signedPath())).status).toBe(200);
    expect((await request(await signedPath(), "HEAD")).status).toBe(200);
  });
  it("answers /directory with 403 when the secret is not set, even for a link signed before", async () => {
    const good = await signedPath();
    env = { ...env, DIRECTORY_LINK_SECRET: "" };
    const response = await request(good);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("This link has expired");
  });
  it("answer /directory without a good link with 403 and the text that the link has expired", async () => {
    const good = await signedPath();
    const forged = good.replace(/sig=[0-9a-f]/, (match) => (match.endsWith("0") ? "sig=1" : "sig=0"));
    const expired = await signedPath(Date.now() - DIRECTORY_LINK_TTL_MS - 1000);
    for (const path of ["/directory", "/directory?exp=9999999999", forged, expired, good.replace("exp=", "exp=1")]) {
      const response = await request(path);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("This link has expired");
    }
  });
  it("give 404 for /reportmap without a known period", async () => {
    expect((await request("/reportmap")).status).toBe(404);
    expect((await request("/reportmap?period=all")).status).toBe(404);
  });
  it("do not answer a POST", async () => {
    expect((await request("/directory", "POST")).status).toBe(404);
  });
});
