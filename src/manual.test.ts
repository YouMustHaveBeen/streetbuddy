import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { PARKING_OPTIONS, ROAD_USER_TYPES } from "./core";
import { INSTALL_PATH } from "./install";
import { MANUAL_PATH, manualPage } from "./manual";
import { CHOOSE_ADDRESS } from "./telegram/address";
import {
  ADD_SEND_LOCATION,
  ADDRESS_ADDED,
  AREA_MAP,
  CANCELLED,
  CHOOSE_PARKING,
  CHOOSE_ROAD_USER,
  FEEDBACK_SENT,
  NO_HOTSPOTS,
  NO_PLATE,
  OPEN_MAP,
  OUT_OF_AREA,
  PHOTO_RECEIVED,
  SEND_PHOTOS,
  SEVERAL_PLATES,
  WRITE_FEEDBACK,
  YOUR_PHONE,
} from "./telegram/dialog";

describe("manual page", () => {
  it("is served as HTML with the title", async () => {
    const response = manualPage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>Руководство по использованию StreetBuddy</title>");
  });

  it("offers Android and iPhone, with the steps written for both", async () => {
    const html = await manualPage().text();
    expect(html).toContain('aria-pressed="true" data-os="android">Android</button>');
    expect(html).toContain('aria-pressed="false" data-os="iphone">iPhone</button>');
    expect(html).toContain('<section data-os-section="iphone" hidden>');
    expect(html).not.toContain("скоро появится");
    expect(html).not.toMatch(/userscripts/i);
    expect(html).toContain('bindChoice("os")');
  });

  it("links to the installation guide and names the bookmark", async () => {
    const html = await manualPage().text();
    expect(html).toContain(`<a href="${INSTALL_PATH}">руководству по установке</a>`);
    expect(html).toContain("qqqwww");
  });

  it("walks through every step with the bot's own button names", async () => {
    const html = await manualPage().text();
    for (const name of ["Other address", "Confirm", "Edit", "Create report", "Edit plate", "Change time", "Done", "Open report", "Cancel", "Click Here to Start", "Submit Report"]) {
      expect(html).toContain(`«${name}»`);
    }
  });

  it("quotes the bot's texts and button names exactly as the bot sends them", async () => {
    const html = await manualPage().text();
    const quoted = [OUT_OF_AREA, CHOOSE_ADDRESS, SEND_PHOTOS, PHOTO_RECEIVED, SEVERAL_PLATES, NO_PLATE, CHOOSE_PARKING, CHOOSE_ROAD_USER, CANCELLED];
    for (const text of [...quoted, ...PARKING_OPTIONS, ...ROAD_USER_TYPES]) {
      expect(html).toContain(text);
    }
  });

  it("lists the commands of the menu with the bot's own words", async () => {
    const html = await manualPage().text();
    for (const text of ["/manual", "/setup", "/map", "/add_address", "/hotspots", "/phone", "/feedback", AREA_MAP, OPEN_MAP, ADD_SEND_LOCATION, ADDRESS_ADDED, NO_HOTSPOTS, YOUR_PHONE, WRITE_FEEDBACK, FEEDBACK_SENT]) {
      expect(html).toContain(text);
    }
    expect(html.split("<h2>Команды бота</h2>")).toHaveLength(3);
  });

  it("does not use the word Garda, the word for a link, or the letter yo", async () => {
    const html = await manualPage().text();
    const yo = String.fromCharCode(0x451);
    expect(html).not.toMatch(/garda/i);
    expect(html).not.toMatch(/ссыл/i);
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
