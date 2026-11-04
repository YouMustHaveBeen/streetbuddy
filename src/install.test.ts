import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./index";
import { INSTALL_PATH, INSTALL_URL, SCRIPT_PATH, installPage, userscriptFile } from "./install";

describe("installation guide page", () => {
  it("is served as HTML", async () => {
    const response = installPage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("has the title, the two links and the install button", async () => {
    const html = await installPage().text();
    expect(html).toContain("<title>Руководство по установке StreetBuddy</title>");
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=org.mozilla.firefox"');
    expect(html).toContain('href="https://addons.mozilla.org/firefox/addon/violentmonkey/"');
    expect(html).toContain(`href="${SCRIPT_PATH}">Установить скрипт</a>`);
  });

  it("offers only Android and Firefox", async () => {
    const html = await installPage().text();
    expect(html).toContain('aria-pressed="true">Android</button>');
    expect(html).toContain('aria-pressed="true">Firefox</button>');
    expect(html).toContain("disabled>iPhone</button>");
    expect(html).toContain("disabled>Chrome</button>");
  });

  it("does not use the word Garda or the letter yo", async () => {
    const html = await installPage().text();
    const yo = String.fromCharCode(0x451);
    expect(html).not.toMatch(/garda/i);
    expect(html.includes(yo)).toBe(false);
  });
});

describe("userscript file", () => {
  it("is served as JavaScript and starts with the userscript header", async () => {
    const response = userscriptFile();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect((await response.text()).startsWith("// ==UserScript==")).toBe(true);
  });
});

describe("Worker routes", () => {
  const env = {} as Env;
  const ctx = {} as ExecutionContext;
  const get = (path: string, method = "GET") =>
    worker.fetch(new Request(`https://example.com${path}`, { method }), env, ctx);

  it("serves the page and the script on GET", async () => {
    expect((await get(INSTALL_PATH)).status).toBe(200);
    expect((await get(SCRIPT_PATH)).status).toBe(200);
  });

  it("answers 404 to other methods and other paths", async () => {
    expect((await get(INSTALL_PATH, "POST")).status).toBe(404);
    expect((await get(SCRIPT_PATH, "POST")).status).toBe(404);
    expect((await get("/other")).status).toBe(404);
  });

  it("gives the bot a link to the page path", () => {
    expect(INSTALL_URL.endsWith(INSTALL_PATH)).toBe(true);
  });
});
