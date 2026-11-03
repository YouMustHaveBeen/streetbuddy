import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { handleWebhook } from "./webhook";
import type { WebhookEnv } from "./webhook";

function testD1() {
  const { db, sqlite } = fakeD1();
  const count = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM processed_updates").get() as { n: number }).n;
  return { db, sqlite, count };
}

const SECRET = "s3cret";
let env: WebhookEnv;
let rows: () => number;
let sqlite: ReturnType<typeof fakeD1>["sqlite"];
let pending: Promise<unknown>[];
const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) } as unknown as ExecutionContext;

// Answers getChatMember with the given result; every call is recorded.
function telegram(member: unknown) {
  const mock = vi.fn(async (url: string, _init: RequestInit) =>
    String(url).endsWith("/getChatMember")
      ? new Response(JSON.stringify(member), { status: 200 })
      : new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}
const memberOf = (status: string, is_member?: boolean) => ({ ok: true, result: { status, is_member } });
const methods = (mock: ReturnType<typeof telegram>) => mock.mock.calls.map(([url]) => String(url).split("/").pop());
const bodyOf = (mock: ReturnType<typeof telegram>, method: string) =>
  JSON.parse(String(mock.mock.calls.find(([url]) => String(url).endsWith(method))?.[1].body));

async function send(update: unknown, secret: string | null = SECRET, raw?: string) {
  const headers: Record<string, string> = secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {};
  const response = await handleWebhook(
    new Request("https://example.com/webhook", { method: "POST", headers, body: raw ?? JSON.stringify(update) }),
    env,
    ctx,
  );
  await Promise.all(pending);
  return response;
}

const privateMessage = (updateId = 1, userId = 42) => ({
  update_id: updateId,
  message: { chat: { id: userId, type: "private" }, from: { id: userId } },
});
const privateButton = (updateId = 1, userId = 42) => ({
  update_id: updateId,
  callback_query: { id: "cb1", from: { id: userId }, message: { chat: { id: userId, type: "private" } } },
});

beforeEach(() => {
  const fake = testD1();
  rows = fake.count;
  sqlite = fake.sqlite;
  pending = [];
  env = { AI: {} as Ai, DB: fake.db, TELEGRAM_BOT_TOKEN: "token", WEBHOOK_SECRET: SECRET, GROUP_ID: "-100123" };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("secret and body", () => {
  it("rejects a wrong or missing secret", async () => {
    const mock = telegram(memberOf("member"));
    expect((await send(privateMessage(), "wrong!")).status).toBe(401);
    expect((await send(privateMessage(), null)).status).toBe(401);
    expect(mock).not.toHaveBeenCalled();
    expect(rows()).toBe(0);
  });
  it("rejects everything when no secret is configured", async () => {
    env.WEBHOOK_SECRET = "";
    telegram(memberOf("member"));
    expect((await send(privateMessage(), "")).status).toBe(401);
  });
  it("rejects a body that is not JSON", async () => {
    expect((await send(null, SECRET, "not json")).status).toBe(400);
  });
  it.each([["null"], ["42"], ['"text"'], ["[]"]])("rejects JSON that is not an object: %s", async (raw) => {
    const mock = telegram(memberOf("member"));
    expect((await send(null, SECRET, raw)).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("what is ignored", () => {
  it("ignores group messages without touching D1 or Telegram", async () => {
    const mock = telegram(memberOf("member"));
    await send({ update_id: 1, message: { chat: { id: -100123, type: "supergroup" }, from: { id: 42 } } });
    expect(mock).not.toHaveBeenCalled();
    expect(rows()).toBe(0);
  });
  it("ignores other update types", async () => {
    const mock = telegram(memberOf("member"));
    await send({ update_id: 1, edited_message: { chat: { id: 42, type: "private" }, from: { id: 42 } } });
    expect(mock).not.toHaveBeenCalled();
    expect(rows()).toBe(0);
  });
});

describe("failures in the background", () => {
  it("logs the update_id and the step instead of throwing", async () => {
    const mock = telegram(memberOf("member"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    env.DB = {
      prepare: () => {
        throw new Error("D1 is down");
      },
    } as unknown as D1Database;
    expect((await send(privateMessage(9))).status).toBe(200);
    expect(log).toHaveBeenCalledWith("Update 9 failed at repeat filter: D1 is down");
    expect(mock).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("repeats", () => {
  it("handles an update_id only once", async () => {
    const mock = telegram(memberOf("member"));
    await send(privateMessage(7));
    await send(privateMessage(7));
    expect(methods(mock)).toEqual(["getChatMember"]);
    expect(rows()).toBe(1);
  });
});

describe("membership", () => {
  it("asks about the configured group and lets members through silently", async () => {
    const mock = telegram(memberOf("member"));
    expect((await send(privateMessage(1, 42))).status).toBe(200);
    expect(methods(mock)).toEqual(["getChatMember"]);
    expect(bodyOf(mock, "getChatMember")).toEqual({ chat_id: "-100123", user_id: 42 });
  });
  it.each([["creator"], ["administrator"]])("accepts %s", async (status) => {
    const mock = telegram(memberOf(status));
    await send(privateMessage());
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
  it("accepts a restricted user who is still in the group", async () => {
    const mock = telegram(memberOf("restricted", true));
    await send(privateMessage());
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
  it.each([[memberOf("left")], [memberOf("kicked")], [memberOf("restricted", false)]])(
    "tells %j it is members only",
    async (answer) => {
      const mock = telegram(answer);
      await send(privateMessage(1, 42));
      expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
      expect(bodyOf(mock, "sendMessage")).toEqual({
        chat_id: 42,
        text: "This bot is only for members of the group.",
      });
    },
  );
  it("answers a button press from a non-member with a pop-up", async () => {
    const mock = telegram(memberOf("left"));
    await send(privateButton());
    expect(methods(mock)).toEqual(["getChatMember", "answerCallbackQuery"]);
    expect(bodyOf(mock, "answerCallbackQuery")).toEqual({
      callback_query_id: "cb1",
      text: "This bot is only for members of the group.",
    });
  });
  it("passes a member's button press to the dialog", async () => {
    const mock = telegram(memberOf("member"));
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'address', 'x', 5, ?)",
      )
      .run(Date.now());
    const press = privateButton() as any;
    press.callback_query.data = "address_ok";
    press.callback_query.message.message_id = 5;
    await send(press);
    expect(bodyOf(mock, "sendMessage").text).toBe("Now send photos, the first one with the number plate.");
  });
  it("lets nobody in and says nothing when Telegram fails the check", async () => {
    const mock = telegram({ ok: false, error_code: 400 });
    expect((await send(privateMessage())).status).toBe(200);
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
});

describe("/admin", () => {
  const SCREEN_ID = 99;
  const OLD_SCREEN_ID = 5;
  const textMessage = (text: string, updateId = 1) => {
    const update = privateMessage(updateId) as any;
    update.message.text = text;
    return update;
  };
  const adminButton = (data: string, updateId = 1) => {
    const press = privateButton(updateId) as any;
    press.callback_query.data = data;
    press.callback_query.message.message_id = OLD_SCREEN_ID;
    return press;
  };
  // Like telegram(), but a sent message gets an id, as it does in real life.
  function adminTelegram(status: string) {
    const mock = vi.fn(async (url: string, _init: RequestInit) => {
      const method = String(url).split("/").pop();
      if (method === "getChatMember") return new Response(JSON.stringify(memberOf(status)));
      if (method === "sendMessage") {
        return new Response(JSON.stringify({ ok: true, result: { message_id: SCREEN_ID } }));
      }
      return new Response(JSON.stringify({ ok: true, result: true }));
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  const enabled = () => (sqlite.prepare("SELECT enabled FROM bot_switch").get() as { enabled: number }).enabled;

  it.each([["creator"], ["administrator"]])("shows the screen to the %s of the group", async (status) => {
    const mock = adminTelegram(status);
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
    expect(bodyOf(mock, "sendMessage")).toEqual({
      chat_id: 42,
      text: "Bot: on\nLast form check: none yet",
      reply_markup: { inline_keyboard: [[{ text: "Switch off", callback_data: "admin_off" }]] },
    });
  });
  it("answers /admin written with the bot name", async () => {
    const mock = adminTelegram("administrator");
    await send(textMessage("/admin@streetbuddy_bot"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
  });
  it("shows the state and the last check, in Dublin time", async () => {
    const mock = adminTelegram("administrator");
    sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();
    sqlite
      .prepare("INSERT INTO form_check (id, checked_at, result) VALUES (1, ?, 'changed')")
      .run(Date.UTC(2026, 10, 3, 6, 0));
    await send(textMessage("/admin"));
    expect(bodyOf(mock, "sendMessage")).toEqual({
      chat_id: 42,
      text: "Bot: off\nLast form check: 03/11/2026 06:00 - form changed",
      reply_markup: { inline_keyboard: [[{ text: "Switch on", callback_data: "admin_on" }]] },
    });
  });
  it.each([
    ["ok", "OK"],
    ["unloaded", "page not loaded"],
  ])("writes the result %s as %s", async (result, text) => {
    const mock = adminTelegram("creator");
    sqlite
      .prepare("INSERT INTO form_check (id, checked_at, result) VALUES (1, ?, ?)")
      .run(Date.UTC(2026, 6, 15, 5, 30), result);
    await send(textMessage("/admin"));
    expect(bodyOf(mock, "sendMessage").text).toBe(`Bot: on\nLast form check: 15/07/2026 06:30 - ${text}`);
  });
  it("gives a member who is not an administrator no answer at all", async () => {
    const mock = adminTelegram("member");
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
  it("does not give the command to the report dialog", async () => {
    const mock = adminTelegram("member");
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'address', 'x', 5, ?)",
      )
      .run(Date.now());
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
  it("tells someone who is not in the group that the bot is for members only", async () => {
    const mock = adminTelegram("left");
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
    expect(bodyOf(mock, "sendMessage").text).toBe("This bot is only for members of the group.");
  });
  it("leaves a report in progress as it is", async () => {
    const mock = adminTelegram("administrator");
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'address', 'x', 5, ?)",
      )
      .run(Date.now());
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
    expect(sqlite.prepare("SELECT step, buttons_message_id FROM drafts").all()).toEqual([
      { step: "address", buttons_message_id: 5 },
    ]);
  });
  it("switches the bot off, shows the new screen and removes the old one", async () => {
    const mock = adminTelegram("administrator");
    await send(adminButton("admin_off"));
    expect(enabled()).toBe(0);
    expect(methods(mock)).toEqual(["getChatMember", "answerCallbackQuery", "sendMessage", "deleteMessage"]);
    expect(bodyOf(mock, "answerCallbackQuery")).toEqual({ callback_query_id: "cb1" });
    expect(bodyOf(mock, "sendMessage")).toEqual({
      chat_id: 42,
      text: "Bot: off\nLast form check: none yet",
      reply_markup: { inline_keyboard: [[{ text: "Switch on", callback_data: "admin_on" }]] },
    });
    expect(bodyOf(mock, "deleteMessage")).toEqual({ chat_id: 42, message_id: OLD_SCREEN_ID });
  });
  it("switches the bot on", async () => {
    const mock = adminTelegram("creator");
    sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();
    await send(adminButton("admin_on"));
    expect(enabled()).toBe(1);
    expect(bodyOf(mock, "sendMessage").text).toBe("Bot: on\nLast form check: none yet");
  });
  it("sets the state a button names, so an old screen cannot flip it the wrong way", async () => {
    const mock = adminTelegram("administrator");
    sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();
    await send(adminButton("admin_off"));
    expect(enabled()).toBe(0);
    expect(bodyOf(mock, "sendMessage").text).toBe("Bot: off\nLast form check: none yet");
  });
  it("does not remove the old screen when the new one could not be sent", async () => {
    const mock = adminTelegram("administrator");
    mock.mockImplementation(async (url: string) => {
      const method = String(url).split("/").pop();
      if (method === "getChatMember") return new Response(JSON.stringify(memberOf("administrator")));
      if (method === "sendMessage") return new Response(JSON.stringify({ ok: false, error_code: 400 }));
      return new Response(JSON.stringify({ ok: true, result: true }));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await send(adminButton("admin_off"));
    expect(methods(mock)).not.toContain("deleteMessage");
    expect(enabled()).toBe(0);
  });
  it("gives a member who is not an administrator no answer to the button and leaves the bot as it is", async () => {
    const mock = adminTelegram("member");
    await send(adminButton("admin_off"));
    expect(methods(mock)).toEqual(["getChatMember"]);
    expect(enabled()).toBe(1);
  });
});
