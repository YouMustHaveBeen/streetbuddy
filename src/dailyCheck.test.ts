import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../test/fakeD1";
import { runFormCheck } from "./dailyCheck";
import worker from "./index";
import type { Env } from "./index";

const PAGE_URL = "https://www.garda.ie/en/trafficwatchreport/";
const FORM = readFileSync("test/userscript/form.html", "utf8");
const TEXT =
  "The Traffic Watch report form has changed, so the bot is temporarily not working. The developer has been notified.";

let page: () => Response;
let sent: { chat_id: string; text: string }[];
let sqlite: ReturnType<typeof fakeD1>["sqlite"];
let env: Env;
let pageRequests: number;
let sendFails: boolean;

const enabled = () => (sqlite.prepare("SELECT enabled FROM bot_switch").get() as { enabled: number }).enabled;

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  env = {
    DB: fake.db,
    TELEGRAM_BOT_TOKEN: "token",
    OWNER_TELEGRAM_ID: "111",
    GROUP_ID: "-100222",
  } as Env;
  sent = [];
  pageRequests = 0;
  sendFails = false;
  page = () => new Response(FORM);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const address = String(url);
      if (address === PAGE_URL) {
        pageRequests += 1;
        return page();
      }
      if (address.endsWith("/sendMessage")) {
        sent.push(JSON.parse(String(init?.body)));
        if (sendFails) return new Response(JSON.stringify({ ok: false, error_code: 400 }));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      }
      return new Response("", { status: 404 });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runFormCheck", () => {
  it("leaves the bot on and says nothing when the form is unchanged", async () => {
    await runFormCheck(env);
    expect(enabled()).toBe(1);
    expect(sent).toEqual([]);
  });

  it("turns the bot off and tells the owner twice and the group once", async () => {
    page = () => new Response(FORM.replace('id="Location"', 'id="Place"'));
    await runFormCheck(env);
    expect(enabled()).toBe(0);
    expect(sent).toEqual([
      { chat_id: "111", text: TEXT },
      { chat_id: "111", text: TEXT },
      { chat_id: "-100222", text: TEXT },
    ]);
  });

  it("turns the bot off when the page cannot be loaded", async () => {
    page = () => new Response("", { status: 503 });
    await runFormCheck(env);
    expect(enabled()).toBe(0);
    expect(pageRequests).toBe(2);
    expect(sent).toHaveLength(3);
  });

  it("says nothing more while the bot stays off", async () => {
    page = () => new Response("", { status: 503 });
    await runFormCheck(env);
    await runFormCheck(env);
    expect(enabled()).toBe(0);
    expect(sent).toHaveLength(3);
  });

  it("does not turn the bot on again when the form is fine", async () => {
    sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();
    await runFormCheck(env);
    expect(enabled()).toBe(0);
    expect(sent).toEqual([]);
  });

  it("logs how many messages of the alert did not arrive", async () => {
    sendFails = true;
    page = () => new Response(FORM.replace('id="Location"', 'id="Place"'));
    await runFormCheck(env);
    expect(enabled()).toBe(0);
    expect(console.error).toHaveBeenCalledWith("Form change alert: 3 of 3 messages not delivered");
  });

  it("tells again after the owner has turned the bot on and the form is still wrong", async () => {
    page = () => new Response("", { status: 503 });
    await runFormCheck(env);
    sqlite.prepare("UPDATE bot_switch SET enabled = 1").run();
    await runFormCheck(env);
    expect(sent).toHaveLength(6);
  });
});

describe("scheduled form check", () => {
  const run = (scheduledTime: number) =>
    worker.scheduled({ scheduledTime } as ScheduledController, env, {} as ExecutionContext);

  it.each([
    ["winter, 6:00 UTC is 6:00 in Dublin", Date.UTC(2026, 11, 15, 6, 0), true],
    ["winter, 5:00 UTC is 5:00 in Dublin", Date.UTC(2026, 11, 15, 5, 0), false],
    ["summer, 5:00 UTC is 6:00 in Dublin", Date.UTC(2026, 6, 15, 5, 0), true],
    ["summer, 6:00 UTC is 7:00 in Dublin", Date.UTC(2026, 6, 15, 6, 0), false],
  ])("%s", async (_name, time, runs) => {
    await run(time);
    expect(pageRequests).toBe(runs ? 1 : 0);
  });

  it("does not throw when the check itself fails", async () => {
    sqlite.exec("DROP TABLE bot_switch");
    page = () => new Response("", { status: 503 });
    await expect(run(Date.UTC(2026, 11, 15, 6, 0))).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("scheduled: form check failed", expect.any(Error));
  });
});
