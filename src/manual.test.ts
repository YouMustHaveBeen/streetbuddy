import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./index";
import { PARKING_OPTIONS, ROAD_USER_TYPES } from "./core";
import { INSTALL_PATH } from "./install";
import { MANUAL_PATH, manualPage } from "./manual";
import {
  CANCELLED,
  CHOOSE_PARKING,
  CHOOSE_ROAD_USER,
  NO_PLATE,
  OUT_OF_AREA,
  PHOTO_RECEIVED,
  SEND_PHOTOS,
  SEVERAL_PLATES,
} from "./telegram/dialog";

describe("manual page", () => {
  it("is served as HTML with the title", async () => {
    const response = manualPage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>Руководство по использованию StreetBuddy</title>");
  });

  it("offers Android and iPhone, with only the Android steps written", async () => {
    const html = await manualPage().text();
    expect(html).toContain('aria-pressed="true" data-os="android">Android</button>');
    expect(html).toContain('aria-pressed="false" data-os="iphone">iPhone</button>');
    expect(html).toContain('<section data-os-section="iphone" hidden>');
    expect(html).toContain("Инструкция для iPhone скоро появится.");
    expect(html).toContain('bindChoice("os")');
  });

  it("links to the installation guide and names the bookmark", async () => {
    const html = await manualPage().text();
    expect(html).toContain(`<a href="${INSTALL_PATH}">руководству по установке</a>`);
    expect(html).toContain("qqqwww");
  });

  it("walks through every step with the bot's own button names", async () => {
    const html = await manualPage().text();
    for (const name of ["Confirm", "Edit", "Create report", "Edit plate", "Change time", "Done", "Open report", "Cancel", "Click Here to Start", "Submit Report"]) {
      expect(html).toContain(`«${name}»`);
    }
  });

  it("quotes the bot's texts and button names exactly as the bot sends them", async () => {
    const html = await manualPage().text();
    const quoted = [OUT_OF_AREA, SEND_PHOTOS, PHOTO_RECEIVED, SEVERAL_PLATES, NO_PLATE, CHOOSE_PARKING, CHOOSE_ROAD_USER, CANCELLED];
    for (const text of [...quoted, ...PARKING_OPTIONS, ...ROAD_USER_TYPES]) {
      expect(html).toContain(text);
    }
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
