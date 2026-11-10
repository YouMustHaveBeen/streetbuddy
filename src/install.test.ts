import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { INSTALL_PATH, SCRIPT_PATH, installPage, userscriptFile } from "./install";

describe("installation guide page", () => {
  it("is served as HTML", async () => {
    const response = installPage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("has the title", async () => {
    const html = await installPage().text();
    expect(html).toContain("<title>StreetBuddy</title>");
  });

  it("offers Android and iPhone", async () => {
    const html = await installPage().text();
    expect(html).toContain('aria-pressed="true" data-os="android">Android</button>');
    expect(html).toContain('aria-pressed="false" data-os="iphone">iPhone</button>');
    expect(html).toContain('<button class="install" type="submit">Prepare bookmark</button>');
    expect(html).toContain('<button class="install" type="submit">Подготовить закладку</button>');
    expect(html).not.toContain("data-browser");
  });

  it("offers English first and by default, then Russian", async () => {
    const html = await installPage().text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('aria-pressed="true" data-lang="en">English</button><button type="button" aria-pressed="false" data-lang="ru">Русский</button>');
    expect(html.indexOf('data-lang-section="en"')).toBeLessThan(html.indexOf('data-lang-section="ru"'));
    expect(html).toContain('<div lang="ru" data-lang-section="ru" hidden>');
    expect(html).not.toContain('<div lang="en" data-lang-section="en" hidden>');
  });

  it("does not carry the userscript itself: the bookmarklet loads it from the Worker", async () => {
    const html = await installPage().text();
    expect(html).toContain(`location.origin + "${SCRIPT_PATH}"`);
    expect(html).not.toContain("validateReport");
    expect(html).not.toContain("==UserScript==");
  });

  it("does not use the letter yo", async () => {
    const html = await installPage().text();
    const yo = String.fromCharCode(0x451);
    expect(html.includes(yo)).toBe(false);
  });
});

describe("userscript file", () => {
  it("has a version", async () => {
    const file = await userscriptFile().text();
    expect(file).toMatch(/^\/\/ @version\s+\d+\.\d+\.\d+$/m);
  });

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

  it("serves the page as HTML on GET", async () => {
    const response = await get(INSTALL_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>StreetBuddy</title>");
  });

  it("serves the script as JavaScript on GET", async () => {
    const response = await get(SCRIPT_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect((await response.text()).startsWith("// ==UserScript==")).toBe(true);
  });

  it("answers HEAD like GET", async () => {
    const page = await get(INSTALL_PATH, "HEAD");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const script = await get(SCRIPT_PATH, "HEAD");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("answers 404 to other methods and other paths", async () => {
    expect((await get(INSTALL_PATH, "POST")).status).toBe(404);
    expect((await get(SCRIPT_PATH, "POST")).status).toBe(404);
    expect((await get("/other")).status).toBe(404);
  });
});
