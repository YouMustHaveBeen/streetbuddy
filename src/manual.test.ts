import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { PARKING_OPTIONS, ROAD_USER_TYPES } from "./core";
import { INSTALL_PATH } from "./install";
import { MANUAL_PATH, manualPage } from "./manual";
import { AREA_MAP } from "./telegram/dialog";

describe("manual page", () => {
  it("is served as HTML with the title", async () => {
    const response = manualPage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>StreetBuddy User guide</title>");
  });

  it("offers English first and Russian, and Android and iPhone, with the steps written for both", async () => {
    const html = await manualPage().text();
    expect(html).toContain('<button type="button" aria-pressed="true" data-lang="en">English</button><button type="button" aria-pressed="false" data-lang="ru">Russian</button>');
    expect(html).toContain('<div lang="ru" data-lang-section="ru" hidden>');
    expect(html).toContain('aria-pressed="true" data-os="android">Android</button>');
    expect(html).toContain('aria-pressed="false" data-os="iphone">iPhone</button>');
    expect(html).toContain('<section data-os-section="iphone" hidden>');
    expect(html).not.toMatch(/userscripts/i);
    expect(html).toContain('bindChoice("lang")');
  });

  it("links to the installation guide in both languages and names the bookmark", async () => {
    const html = await manualPage().text();
    expect(html).toContain(`<a href="${INSTALL_PATH}">setup guide</a>`);
    expect(html).toContain(`<a href="${INSTALL_PATH}">руководству по установке</a>`);
    expect(html).toContain("qqqwww");
  });

  it("has no repeated element ids", async () => {
    const html = await manualPage().text();
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const target of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(target[1]);
  });

  it("walks through every step with the bot's own button names", async () => {
    const html = await manualPage().text();
    for (const name of ["Other address", "Add", "Create report", "Done", "Open report", "Cancel", "Click Here to Start", "Submit Report"]) {
      expect(html).toContain(`«${name}»`);
    }
  });

  it("names the parking options as the bot does and the roles in lower case", async () => {
    const html = await manualPage().text();
    for (const text of PARKING_OPTIONS) expect(html).toContain(text);
    for (const text of ROAD_USER_TYPES) expect(html).toContain(text.toLowerCase());
  });

  it("lists the commands of the menu in both languages", async () => {
    const html = await manualPage().text();
    for (const text of ["/map", "/add_address", "/hotspots", "/invite", "/phone", "/help", "/feedback", AREA_MAP]) {
      expect(html).toContain(text);
    }
    expect(html.split("3 Команды бота</h2>")).toHaveLength(3);
    expect(html.split("3 Bot commands</h2>")).toHaveLength(3);
  });

  it("does not use the letter yo", async () => {
    const html = await manualPage().text();
    const yo = String.fromCharCode(0x451);
    expect(html.includes(yo)).toBe(false);
  });
});

describe("manual route", () => {
  const env = {} as Env;
  const ctx = {} as ExecutionContext;
  const get = (method: string) =>
    worker.fetch(new Request(`https://example.com${MANUAL_PATH}`, { method }), env, ctx);

  it("serves the page on GET and HEAD", async () => {
    for (const method of ["GET", "HEAD"]) {
      const response = await get(method);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    }
  });

  it("answers 404 to other methods", async () => {
    expect((await get("POST")).status).toBe(404);
  });
});
