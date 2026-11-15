import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./env";
import { PRIVACY_PATH, privacyPage } from "./privacy";

describe("privacy policy page", () => {
  it("is served as HTML with the title", async () => {
    const response = privacyPage();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>StreetBuddy Privacy Policy</title>");
  });

  it("offers English first and Russian", async () => {
    const html = await privacyPage().text();
    expect(html).toContain('<button type="button" aria-pressed="true" data-lang="en">English</button><button type="button" aria-pressed="false" data-lang="ru">Russian</button>');
    expect(html).toContain('<div lang="en" data-lang-section="en">');
    expect(html).toContain('<div lang="ru" data-lang-section="ru" hidden>');
    expect(html).toContain('bindChoice("lang")');
  });

  it("has the retention table in both languages and no draft note", async () => {
    const html = await privacyPage().text();
    expect(html.match(/<table>/g)).toHaveLength(2);
    expect(html).toContain("<h2>How long things are kept</h2>");
    expect(html).toContain("<h2>Как долго хранятся данные</h2>");
    expect(html).not.toMatch(/draft text|not yet published/i);
  });

  it("tells in both languages that /forget_me deletes the data", async () => {
    const html = await privacyPage().text();
    expect(html).toContain("send /forget_me to the bot: it deletes the data and removes you from the group");
    expect(html).toContain("отправьте боту /forget_me: он удалит данные и удалит вас из группы");
  });

  it("is served by the Worker on GET and HEAD only", async () => {
    const env = {} as Env;
    const ctx = {} as ExecutionContext;
    const get = await worker.fetch(new Request(`https://site.example${PRIVACY_PATH}`), env, ctx);
    expect(get.status).toBe(200);
    const head = await worker.fetch(new Request(`https://site.example${PRIVACY_PATH}`, { method: "HEAD" }), env, ctx);
    expect(head.status).toBe(200);
    const post = await worker.fetch(new Request(`https://site.example${PRIVACY_PATH}`, { method: "POST" }), env, ctx);
    expect(post.status).toBe(404);
  });
});
