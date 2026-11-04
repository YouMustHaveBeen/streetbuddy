import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./index";
import userscript from "../userscript/streetbuddy.user.js";
import { INSTALL_PATH, SCRIPT_PATH, installPage, userscriptFile } from "./install";

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

  it("offers Android with Firefox and Chrome, and no iPhone yet", async () => {
    const html = await installPage().text();
    expect(html).toContain('aria-pressed="true">Android</button>');
    expect(html).toContain('aria-pressed="true" data-browser="firefox">Firefox</button>');
    expect(html).toContain('aria-pressed="false" data-browser="chrome">Chrome</button>');
    expect(html).toContain("disabled>iPhone</button>");
    expect(html).toContain('<section data-browser-section="chrome" hidden>');
  });

  it("carries the userscript for the bookmarklet without ending its own script early", async () => {
    const html = await installPage().text();
    const pageScript = html.slice(html.indexOf("<script>") + "<script>".length, html.indexOf("</script>"));
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(pageScript).toContain("var CODE = " + JSON.stringify(userscript).replace(/</g, "\\u003c") + ";");
  });

  it("does not use the word Garda or the letter yo", async () => {
    const html = await installPage().text();
    // The userscript inside the page is checked as it is, not as page text.
    const text = html.replace(JSON.stringify(userscript).replace(/</g, "\\u003c"), "");
    const yo = String.fromCharCode(0x451);
    expect(text).not.toMatch(/garda/i);
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

  it("serves the page as HTML on GET", async () => {
    const response = await get(INSTALL_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>Руководство по установке StreetBuddy</title>");
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
