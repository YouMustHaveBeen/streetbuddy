import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { PARKING_OPTIONS } from "../core";
import { isDirectoryLinkValid } from "../directoryLink";
import { handleWebhook } from "./webhook";
import type { WebhookEnv } from "./webhook";

function testD1() {
  const { db, sqlite } = fakeD1();
  const count = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM processed_updates").get() as { n: number }).n;
  return { db, sqlite, count };
}

const SECRET = "s3cret";
const ADMIN_ROW = [
  { text: "Feedback", callback_data: "admin_feedback" },
  { text: "Statistics", callback_data: "admin_statistics" },
];
const PLATES_ROW = [
  { text: "Repeat plates", callback_data: "admin_plates:repeat:0" },
  { text: "Possibly abandoned", callback_data: "admin_plates:abandoned:0" },
];
const ADDRESS_ROW = [
  { text: "Incoming addresses", callback_data: "admin_incoming" },
  { text: "Edit directory", callback_data: "admin_directory" },
];
const FILE_ROW = [
  { text: "Export directory", callback_data: "admin_export" },
  { text: "Import file", callback_data: "admin_import" },
];
const REPORT_MAP_BUTTON = { text: "Report map", callback_data: "admin_reportmap" };
const MAP_ROW = [REPORT_MAP_BUTTON, { text: "Directory map", url: expect.stringContaining("https://site.example/directory?exp=") }];
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
  env = { AI: {} as Ai, DB: fake.db, TELEGRAM_BOT_TOKEN: "token", WEBHOOK_SECRET: SECRET, GROUP_ID: "-100123", SITE_URL: "https://site.example", DIRECTORY_LINK_SECRET: "link-secret" };
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
    expect(log).toHaveBeenCalledWith("Update 9 failed at repeat filter and membership check: D1 is down");
    expect(mock).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("repeats", () => {
  it("handles an update_id only once", async () => {
    const mock = telegram(memberOf("member"));
    await send(privateMessage(7));
    await send(privateMessage(7));
    expect(methods(mock)).toEqual(["getChatMember", "getChatMember"]);
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
  const textUpdate = (text: string, updateId = 1) => {
    const update = privateMessage(updateId, 42) as any;
    update.message.text = text;
    return update;
  };
  it.each([[memberOf("left")], [memberOf("kicked")], [memberOf("restricted", false)]])(
    "tells %j it is members only on /start",
    async (answer) => {
      const mock = telegram(answer);
      await send(textUpdate("/start"));
      expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
      expect(bodyOf(mock, "sendMessage")).toEqual({
        chat_id: 42,
        text: "This bot is only for members of the group",
      });
    },
  );
  it("answers /start written with the bot name to a non-member too", async () => {
    const mock = telegram(memberOf("left"));
    await send(textUpdate("/start@streetbuddy_bot"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
  });
  it.each([["/map"], ["/manual"], ["/hotspots"], ["/feedback"], ["/phone"], ["hello"]])(
    "says nothing to a non-member who writes %s",
    async (text) => {
      const mock = telegram(memberOf("left"));
      await send(textUpdate(text));
      expect(methods(mock)).toEqual(["getChatMember"]);
    },
  );
  it("says nothing to a non-member who sends a location or a photo", async () => {
    const mock = telegram(memberOf("left"));
    const update = privateMessage(1, 42) as any;
    update.message.location = { latitude: 53.4, longitude: -6.1 };
    await send(update);
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
  it("counts the attempts of someone who is not a member, and a member does not add to it", async () => {
    telegram(memberOf("left"));
    await send(privateMessage(1, 42));
    await send(privateMessage(2, 43));
    expect(sqlite.prepare("SELECT event, n FROM daily_counts").all()).toEqual([{ event: "outsiders", n: 2 }]);
    telegram(memberOf("member"));
    await send(privateMessage(3, 44));
    expect(sqlite.prepare("SELECT SUM(n) AS n FROM daily_counts").get()).toEqual({ n: 2 });
  });
  it("does not check membership on an ordinary button", async () => {
    const mock = telegram(memberOf("left"));
    const press = privateButton() as any;
    press.callback_query.data = "cancel";
    await send(press);
    expect(methods(mock)).toEqual(["answerCallbackQuery"]);
  });
  it("only acknowledges a non-member's press of the button that leads to the link and keeps the draft", async () => {
    const mock = telegram(memberOf("left"));
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'review', 'x', 5, ?)",
      )
      .run(Date.now());
    const press = privateButton() as any;
    press.callback_query.data = "review_ok";
    press.callback_query.message.message_id = 5;
    await send(press);
    expect(methods(mock)).toEqual(["getChatMember", "answerCallbackQuery"]);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "review" }]);
    expect(bodyOf(mock, "answerCallbackQuery")).toEqual({ callback_query_id: "cb1" });
  });
  it("passes a member's button press to the dialog", async () => {
    const mock = telegram(memberOf("member"));
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'address', 'x', 5, ?)",
      )
      .run(Date.now());
    const press = privateButton() as any;
    press.callback_query.data = "addr_other";
    press.callback_query.message.message_id = 5;
    await send(press);
    expect(bodyOf(mock, "sendMessage").text).toBe("Write the address");
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
      text: "Admin console\nBot: on\nLast form check: none yet",
      reply_markup: { inline_keyboard: [[{ text: "Switch off", callback_data: "admin_off" }], ADMIN_ROW, PLATES_ROW, ADDRESS_ROW, FILE_ROW, MAP_ROW] },
    });
  });
  it("gives the map button a link that is signed with the secret and points at the directory page", async () => {
    const mock = adminTelegram("administrator");
    await send(textMessage("/admin"));
    const link = new URL(bodyOf(mock, "sendMessage").reply_markup.inline_keyboard[5][1].url);
    expect(`${link.origin}${link.pathname}`).toBe("https://site.example/directory");
    expect(await isDirectoryLinkValid(env, link.searchParams)).toBe(true);
    expect(await isDirectoryLinkValid({ DIRECTORY_LINK_SECRET: "another" }, link.searchParams)).toBe(false);
  });
  it.each([[""], [undefined]])("shows the screen without the directory map button when the link secret is %j", async (secret) => {
    const mock = adminTelegram("administrator");
    env = { ...env, DIRECTORY_LINK_SECRET: secret as unknown as string };
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
    expect(bodyOf(mock, "sendMessage")).toEqual({
      chat_id: 42,
      text: "Admin console\nBot: on\nLast form check: none yet",
      reply_markup: { inline_keyboard: [[{ text: "Switch off", callback_data: "admin_off" }], ADMIN_ROW, PLATES_ROW, ADDRESS_ROW, FILE_ROW, [REPORT_MAP_BUTTON]] },
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
      text: "Admin console\nBot: off\nLast form check: 03/11/2026 06:00 - form changed",
      reply_markup: { inline_keyboard: [[{ text: "Switch on", callback_data: "admin_on" }], ADMIN_ROW, PLATES_ROW, ADDRESS_ROW, FILE_ROW, MAP_ROW] },
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
    expect(bodyOf(mock, "sendMessage").text).toBe(`Admin console\nBot: on\nLast form check: 15/07/2026 06:30 - ${text}`);
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
  it.each([["left"], ["kicked"]])("gives someone who is not in the group (%s) no answer to /admin either", async (status) => {
    const mock = adminTelegram(status);
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
  it("gives someone who is not in the group no answer to the admin button", async () => {
    const mock = adminTelegram("left");
    await send(adminButton("admin_off"));
    expect(methods(mock)).toEqual(["getChatMember"]);
    expect(enabled()).toBe(1);
  });
  it("stops a report in progress without a word and shows the screen", async () => {
    const mock = adminTelegram("administrator");
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'address', 'x', 5, ?)",
      )
      .run(Date.now());
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "deleteMessage", "sendMessage"]);
    expect(bodyOf(mock, "deleteMessage")).toEqual({ chat_id: 42, message_id: 5 });
    expect(bodyOf(mock, "sendMessage").text).toBe("Admin console\nBot: on\nLast form check: none yet");
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
  });
  it("leaves a report alone while the link is being given", async () => {
    const mock = adminTelegram("administrator");
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'finishing', 'x', 5, ?)",
      )
      .run(Date.now());
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "finishing" }]);
  });
  it("a command removes the admin screen and its button, and a screen never replaces a report", async () => {
    const mock = adminTelegram("administrator");
    await send(textMessage("/admin"));
    expect(sqlite.prepare("SELECT step, buttons_message_id FROM drafts").all()).toEqual([
      { step: "screen", buttons_message_id: SCREEN_ID },
    ]);
    await send(textMessage("/manual", 2));
    expect(bodyOf(mock, "deleteMessage").message_id).toBe(SCREEN_ID);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drafts").get()).toEqual({ n: 0 });
    sqlite
      .prepare("INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'address', 'x', 5, ?)")
      .run(Date.now());
    await send(adminButton("admin_off", 3));
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "address" }]);
  });
  it("leaves a report of another user alone", async () => {
    const mock = adminTelegram("administrator");
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (77, 'address', 'x', 5, ?)",
      )
      .run(Date.now());
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
    expect(sqlite.prepare("SELECT user_id, step FROM drafts ORDER BY user_id").all()).toEqual([
      { user_id: 42, step: "screen" },
      { user_id: 77, step: "address" },
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
      text: "Admin console\nBot: off\nLast form check: none yet",
      reply_markup: { inline_keyboard: [[{ text: "Switch on", callback_data: "admin_on" }], ADMIN_ROW, PLATES_ROW, ADDRESS_ROW, FILE_ROW, MAP_ROW] },
    });
    expect(bodyOf(mock, "deleteMessage")).toEqual({ chat_id: 42, message_id: OLD_SCREEN_ID });
  });
  it("shows the Report map screen with the buttons of the periods and removes the old screen", async () => {
    const mock = adminTelegram("administrator");
    await send(adminButton("admin_reportmap"));
    expect(methods(mock)).toEqual(["getChatMember", "answerCallbackQuery", "sendMessage", "deleteMessage"]);
    expect(bodyOf(mock, "sendMessage")).toEqual({
      chat_id: 42,
      text: "Report map",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Today", callback_data: "map:today" },
            { text: "Week", callback_data: "map:week" },
          ],
          [
            { text: "Last month", callback_data: "map:last_month" },
            { text: "Month before", callback_data: "map:month_before" },
          ],
        ],
      },
    });
    expect(bodyOf(mock, "deleteMessage")).toEqual({ chat_id: 42, message_id: OLD_SCREEN_ID });
    expect(sqlite.prepare("SELECT step, buttons_message_id FROM drafts").all()).toEqual([{ step: "screen", buttons_message_id: SCREEN_ID }]);
  });
  it("gives nobody but an administrator the Report map screen", async () => {
    const mock = adminTelegram("member");
    await send(adminButton("admin_reportmap"));
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
  it("switches the bot on", async () => {
    const mock = adminTelegram("creator");
    sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();
    await send(adminButton("admin_on"));
    expect(enabled()).toBe(1);
    expect(bodyOf(mock, "sendMessage").text).toBe("Admin console\nBot: on\nLast form check: none yet");
  });
  it("sets the state a button names, so an old screen cannot flip it the wrong way", async () => {
    const mock = adminTelegram("administrator");
    sqlite.prepare("UPDATE bot_switch SET enabled = 0").run();
    await send(adminButton("admin_off"));
    expect(enabled()).toBe(0);
    expect(bodyOf(mock, "sendMessage").text).toBe("Admin console\nBot: off\nLast form check: none yet");
  });
  describe("Feedback", () => {
    const addFeedback = (userId: number, text: string, at: number) =>
      sqlite.prepare("INSERT INTO feedback (user_id, text, created_at) VALUES (?, ?, ?)").run(userId, text, at);
    const feedbackButtons = (id: number) => [
      [
        { text: "Delete", callback_data: `admin_fbdel:${id}` },
        { text: "Next", callback_data: `admin_fbnext:${id}` },
      ],
      [{ text: "Back", callback_data: "admin_back" }],
    ];
    it("shows the oldest feedback first with the Telegram ID of its author and the Dublin time", async () => {
      const mock = adminTelegram("administrator");
      addFeedback(777, "Great bot", Date.UTC(2026, 10, 3, 10, 35));
      addFeedback(888, "Another one", Date.UTC(2026, 10, 4, 9, 0));
      await send(adminButton("admin_feedback"));
      expect(methods(mock)).toEqual(["getChatMember", "answerCallbackQuery", "sendMessage", "deleteMessage"]);
      expect(bodyOf(mock, "sendMessage")).toEqual({
        chat_id: 42,
        text: "Feedback 1 of 2\nFrom 777 on 03/11/2026 10:35\nGreat bot",
        reply_markup: { inline_keyboard: feedbackButtons(1) },
      });
      expect(bodyOf(mock, "deleteMessage")).toEqual({ chat_id: 42, message_id: OLD_SCREEN_ID });
    });
    it("Next shows the next one and goes back to the first after the last", async () => {
      const mock = adminTelegram("administrator");
      addFeedback(777, "Great bot", Date.UTC(2026, 10, 3, 10, 35));
      addFeedback(888, "Another one", Date.UTC(2026, 10, 4, 9, 0));
      await send(adminButton("admin_fbnext:1"));
      expect(bodyOf(mock, "sendMessage").text).toBe("Feedback 2 of 2\nFrom 888 on 04/11/2026 09:00\nAnother one");
      mock.mockClear();
      await send(adminButton("admin_fbnext:2", 2));
      expect(bodyOf(mock, "sendMessage").text).toBe("Feedback 1 of 2\nFrom 777 on 03/11/2026 10:35\nGreat bot");
    });
    it("Next on the only feedback shows it again", async () => {
      const mock = adminTelegram("administrator");
      addFeedback(777, "Great bot", Date.UTC(2026, 10, 3, 10, 35));
      await send(adminButton("admin_fbnext:1"));
      expect(bodyOf(mock, "sendMessage").text).toBe("Feedback 1 of 1\nFrom 777 on 03/11/2026 10:35\nGreat bot");
    });
    it("Delete removes that feedback and shows the next one, and the last one is followed by No feedback", async () => {
      const mock = adminTelegram("administrator");
      addFeedback(777, "Great bot", Date.UTC(2026, 10, 3, 10, 35));
      addFeedback(888, "Another one", Date.UTC(2026, 10, 4, 9, 0));
      await send(adminButton("admin_fbdel:1"));
      expect(sqlite.prepare("SELECT user_id FROM feedback").all()).toEqual([{ user_id: 888 }]);
      expect(bodyOf(mock, "sendMessage").text).toBe("Feedback 1 of 1\nFrom 888 on 04/11/2026 09:00\nAnother one");
      mock.mockClear();
      await send(adminButton("admin_fbdel:2", 2));
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get()).toEqual({ n: 0 });
      expect(bodyOf(mock, "sendMessage")).toEqual({
        chat_id: 42,
        text: "No feedback",
        reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin_back" }]] },
      });
    });
    it("Delete of a feedback that is already gone only shows the next one", async () => {
      const mock = adminTelegram("administrator");
      sqlite.prepare("INSERT INTO feedback (id, user_id, text, created_at) VALUES (2, 888, 'Another one', ?)").run(Date.UTC(2026, 10, 4, 9, 0));
      await send(adminButton("admin_fbdel:1"));
      expect(bodyOf(mock, "sendMessage").text).toBe("Feedback 1 of 1\nFrom 888 on 04/11/2026 09:00\nAnother one");
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get()).toEqual({ n: 1 });
    });
    it("says there is no feedback when there is none", async () => {
      const mock = adminTelegram("administrator");
      await send(adminButton("admin_feedback"));
      expect(bodyOf(mock, "sendMessage").text).toBe("No feedback");
    });
    it("keeps the screen as a remembered one, so a command removes it", async () => {
      adminTelegram("administrator");
      addFeedback(777, "Great bot", Date.UTC(2026, 10, 3, 10, 35));
      await send(adminButton("admin_feedback"));
      expect(sqlite.prepare("SELECT step, buttons_message_id FROM drafts").all()).toEqual([
        { step: "screen", buttons_message_id: SCREEN_ID },
      ]);
    });
    it("gives a member who is not an administrator no answer to Delete and leaves the feedback", async () => {
      const mock = adminTelegram("member");
      addFeedback(777, "Great bot", Date.UTC(2026, 10, 3, 10, 35));
      await send(adminButton("admin_fbdel:1"));
      expect(methods(mock)).toEqual(["getChatMember"]);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get()).toEqual({ n: 1 });
    });
  });
  describe("Statistics", () => {
    const NOW = Date.UTC(2026, 10, 10, 12, 0);
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    it("shows yesterday, the last 30 days and all days up to yesterday", async () => {
      const mock = adminTelegram("administrator");
      sqlite
        .prepare("INSERT INTO daily_stats (day, reports, option_0, option_1, option_2, option_3, option_4, option_5, option_6, users) VALUES ('2026-11-09', 4, 2, 0, 0, 0, 0, 0, 1, 3)")
        .run();
      sqlite
        .prepare("INSERT INTO daily_stats (day, reports, option_0, option_1, option_2, option_3, option_4, option_5, option_6, users) VALUES ('2026-09-01', 10, 5, 0, 0, 0, 0, 0, 0, 7)")
        .run();
      sqlite.prepare("INSERT INTO daily_counts (day, event, n) VALUES ('2026-11-09', 'started', 6), ('2026-09-01', 'started', 12), ('2026-11-09', 'outsiders', 1), ('2026-11-10', 'started', 50)").run();
      sqlite.prepare("INSERT INTO user_phones (user_id, phone, reports, last_used_at) VALUES (1, 'android', 1, ?)").run(NOW - 3600000);
      await send(adminButton("admin_statistics"));
      expect(methods(mock)).toEqual(["getChatMember", "answerCallbackQuery", "sendMessage", "deleteMessage"]);
      expect(bodyOf(mock, "sendMessage")).toEqual({
        chat_id: 42,
        text: [
          "Statistics",
          "Yesterday / last 30 days / all days up to yesterday",
          "Links given: 4 / 4 / 14",
          "Reports started: 6 / 6 / 18",
          "Left before the link: 2 / 2 / 4",
          "Users: 3 / 1 / -",
          "Out of area: 0 / 0 / 0",
          "Plate accepted as is: 0 / 0 / 0",
          "Plate corrected: 0 / 0 / 0",
          "Plate written by the user: 0 / 0 / 0",
          "Plate recognitions: 0 / 0 / 0",
          "Workers AI errors: 0 / 0 / 0",
          "Nominatim errors: 0 / 0 / 0",
          "Not group members: 1 / 1 / 1",
          "Parking options",
          `${PARKING_OPTIONS[0]}: 2 / 2 / 7`,
          ...PARKING_OPTIONS.slice(1, 6).map((option) => `${option}: 0 / 0 / 0`),
          `${PARKING_OPTIONS[6]}: 1 / 1 / 1`,
        ].join("\n"),
        reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin_back" }]] },
      });
    });
    it("shows zeros when nothing has been counted", async () => {
      const mock = adminTelegram("administrator");
      await send(adminButton("admin_statistics"));
      expect(bodyOf(mock, "sendMessage").text).toContain("Links given: 0 / 0 / 0\nReports started: 0 / 0 / 0\nLeft before the link: 0 / 0 / 0\nUsers: 0 / 0 / -");
    });
    it("never shows a negative number of reports left before the link", async () => {
      const mock = adminTelegram("administrator");
      sqlite
        .prepare("INSERT INTO daily_stats (day, reports, option_0, option_1, option_2, option_3, option_4, option_5, option_6, users) VALUES ('2026-11-09', 4, 1, 0, 0, 0, 0, 0, 0, 1)")
        .run();
      await send(adminButton("admin_statistics"));
      expect(bodyOf(mock, "sendMessage").text).toContain("Links given: 4 / 4 / 4\nReports started: 0 / 0 / 0\nLeft before the link: 0 / 0 / 0");
    });
    it("gives a member who is not an administrator no answer", async () => {
      const mock = adminTelegram("member");
      await send(adminButton("admin_statistics"));
      expect(methods(mock)).toEqual(["getChatMember"]);
    });
  });
  it("gives a member who is not an administrator no answer to the Feedback button", async () => {
    const mock = adminTelegram("member");
    await send(adminButton("admin_feedback"));
    expect(methods(mock)).toEqual(["getChatMember"]);
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

describe("which buttons check membership", () => {
  const press = (updateId: number, data: string) => {
    const update = privateButton(updateId) as any;
    update.callback_query.data = data;
    return update;
  };
  it.each([
      "cancel",
      "addr:0",
      "addr_other",
      "opt:0",
      "done",
      "create",
      "pick:0",
      "plate_add",
      "plate_ok",
      "plate_edit",
      "time_edit",
      "final_cancel",
      "final_done",
      "phone:android",
      "road:Pedestrian",
    ])(
    "does not check on %s",
    async (data) => {
      const mock = telegram(memberOf("left"));
      await send(press(1, data));
      expect(methods(mock)).not.toContain("getChatMember");
    },
  );
  it.each([
    "admin_on",
    "admin_off",
    "admin_feedback",
    "admin_fbnext:1",
    "admin_fbdel:1",
    "admin_statistics",
    "admin_incoming",
    "admin_directory",
    "admin_in:ok:1:2",
    "admin_kind:ok:1:2",
    "admin_setkind:ok:house:1:2",
    "admin_editkind:1:0",
    "admin_dirkind:house:1",
    "admin_list:0",
    "admin_keep:0",
    "admin_keepkind:0:1",
    "admin_keepset:0:house",
    "admin_rejectgroup",
    "admin_all_walk",
    "admin_all_osm",
    "admin_all_walk:g",
    "admin_back",
    "admin_back:g",
    "admin_addr:1:0",
    "admin_text:1",
    "admin_move:1",
    "admin_del:1",
    "review_ok",
    "map:today",
    "map:week",
    "map:last_month",
    "map:month_before",
  ])(
    "checks on %s",
    async (data) => {
      const mock = telegram(memberOf("left"));
      await send(press(1, data));
      expect(methods(mock)[0]).toBe("getChatMember");
    },
  );
});

describe("/admin: incoming addresses and the directory", () => {
  let updateId = 0;
  let nextId = 0;
  let sent: { method: string; body: any; id: number }[] = [];
  let status = "administrator";
  // While true, Telegram does not take sendMessage.
  let failSend = false;
  beforeEach(() => {
    updateId = 0;
    nextId = 100;
    sent = [];
    status = "administrator";
    failSend = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const method = String(url).split("/").pop() as string;
        if (method === "getChatMember") return new Response(JSON.stringify(memberOf(status)));
        if (failSend && method === "sendMessage") return new Response(JSON.stringify({ ok: false, error_code: 400 }));
        nextId += 1;
        sent.push({ method, body: JSON.parse(String(init.body)), id: nextId });
        return new Response(JSON.stringify({ ok: true, result: { message_id: nextId } }));
      }),
    );
  });
  const of = (method: string) => sent.filter((call) => call.method === method);
  const last = () => of("sendMessage").at(-1)?.body;
  const lastId = () => of("sendMessage").at(-1)?.id as number;
  const pinId = () => of("sendLocation").at(-1)?.id as number;
  const keys = () => (last().reply_markup?.inline_keyboard ?? []).map((row: any[]) => row.map((b) => b.callback_data));
  const labels = () => (last().reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.text);
  const press = async (data: string, messageId = nextId) => {
    const update = privateButton(++updateId) as any;
    update.callback_query.data = data;
    update.callback_query.message.message_id = messageId;
    await send(update);
  };
  const message = async (fields: Record<string, unknown>) => {
    const update = privateMessage(++updateId) as any;
    Object.assign(update.message, { message_id: 500 + updateId, date: 1793000000, ...fields });
    await send(update);
  };
  const addIncoming = (text: string, source: string, geometry: object) =>
    Number(
      sqlite
        .prepare(
          "INSERT INTO incoming_addresses (source, text, kind, geometry, user_id, created_at) VALUES (?, ?, ?, ?, ?, 1)",
        )
        .run(source, text, source === "user" ? "temp" : (geometry as any).type === "Point" ? "house" : "spot", JSON.stringify(geometry), source === "user" ? 7 : null)
        .lastInsertRowid,
    );
  const addAddress = (text: string, kind: string, lat: number, lon: number) =>
    Number(
      sqlite
        .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          text,
          kind === "point" ? "house" : "spot",
          JSON.stringify(
            kind === "point"
              ? { type: "Point", coordinates: [lon, lat] }
              : { type: "LineString", coordinates: [[lon, lat], [lon + 0.0001, lat]] },
          ),
          lon,
          lat,
          kind === "point" ? lon : lon + 0.0001,
          lat,
        ).lastInsertRowid,
    );
  const decision = () => sqlite.prepare("SELECT decision, user_id FROM incoming_addresses").all();

  it("shows an incoming address under a pin with its place in the queue", async () => {
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    addIncoming("Parkside Drive", "walk", { type: "LineString", coordinates: [[-6.16, 53.405], [-6.158, 53.405]] });
    await press("admin_incoming", 5);
    expect(of("sendLocation")[0].body).toEqual({ chat_id: 42, latitude: 53.405, longitude: -6.16 });
    const pin = pinId();
    expect(last().text).toBe("Incoming address 1 of 2\n5 New Street\nPoint, written by a user");
    expect(keys()).toEqual([
      [`admin_kind:ok:${id}:${pin}`, `admin_in:no:${id}:${pin}`, `admin_in:next:${id}:${pin}`],
      [`admin_intext:${id}:${pin}`, `admin_inkind:${id}:${pin}`],
      [`admin_all_walk:${pin}`, `admin_back:${pin}`],
      [`admin_all_osm:${pin}`],
    ]);
    expect(labels()).toEqual(["Approve", "Reject", "Next", "Edit text", "Edit kind", "Approve all from the walk", "Back", "Approve all from OSM"]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual([5]);
  });
  it("changes the kind of an incoming address and shows the same address again without deciding", async () => {
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_incoming", 5);
    const [screen, pin] = [lastId(), pinId()];
    await press(`admin_inkind:${id}:${pin}`, screen);
    expect(last().text).toBe("Choose the kind");
    expect(labels()).toEqual(["house", "appt", "facility", "spot", "Back"]);
    await press(`admin_insetkind:spot:${id}:${pin}`, lastId());
    expect(sqlite.prepare("SELECT kind, decision FROM incoming_addresses WHERE id = ?").get(id)).toEqual({ kind: "spot", decision: null });
    expect(last().text).toBe("Incoming address 1 of 1\n5 New Street\nPoint (spot), written by a user");
  });
  it("shows the kind of an address of a user, and not the kind temp", async () => {
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_incoming", 5);
    expect(last().text).toBe("Incoming address 1 of 1\n5 New Street\nPoint, written by a user");
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'facility' WHERE id = ?").run(id);
    await press("admin_incoming", 5);
    expect(last().text).toBe("Incoming address 1 of 1\n5 New Street\nPoint (facility), written by a user");
  });
  it("shows the kind of an address of a user in a group of duplicates", async () => {
    addIncoming("5 New Street", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.1601, 53.405] });
    sqlite.prepare("UPDATE incoming_addresses SET kind = 'appt' WHERE id = ?").run(id);
    await press("admin_incoming", 5);
    expect(last().text).toContain("new2: Point (appt), written by a user");
  });
  it("after the text is changed to that of an earlier address, shows the group of that text", async () => {
    addIncoming("A St", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    addIncoming("B St", "walk", { type: "Point", coordinates: [-6.1601, 53.405] });
    const third = addIncoming("C St", "walk", { type: "Point", coordinates: [-6.1602, 53.405] });
    addIncoming("D St", "walk", { type: "Point", coordinates: [-6.1603, 53.405] });
    await press(`admin_intext:${third}`, 5);
    await message({ text: "A St" });
    expect(last().text).toContain("Same address, 2 objects");
    expect(last().text).toContain("A St");
  });
  it("changes the text of an incoming address and shows the same address again without deciding", async () => {
    const id = addIncoming("5 New Street", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_incoming", 5);
    const [screen, pin] = [lastId(), pinId()];
    await press(`admin_intext:${id}:${pin}`, screen);
    expect(last().text).toBe("Write the new address");
    await message({ text: "  6 New Street, D13 " });
    expect(sqlite.prepare("SELECT text, decision FROM incoming_addresses WHERE id = ?").get(id)).toEqual({ text: "6 New Street", decision: null });
    expect(last().text.startsWith("Incoming address 1 of 1\n6 New Street")).toBe(true);
  });
  it("asks for the kind of an address of a user, keeping its pin, and approves with the chosen kind", async () => {
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    addIncoming("Parkside Drive", "walk", { type: "LineString", coordinates: [[-6.16, 53.405], [-6.158, 53.405]] });
    await press("admin_incoming", 5);
    const [screen, pin] = [lastId(), pinId()];
    await press(`admin_kind:ok:${id}:${pin}`, screen);
    expect(last().text).toBe("Choose the kind");
    expect(labels()).toEqual(["house", "appt", "facility", "spot", "Back"]);
    expect(keys()).toEqual([
      [`admin_setkind:ok:house:${id}:${pin}`],
      [`admin_setkind:ok:appt:${id}:${pin}`],
      [`admin_setkind:ok:facility:${id}:${pin}`],
      [`admin_setkind:ok:spot:${id}:${pin}`],
      [`admin_in:same:${id}:${pin}`],
    ]);
    expect(decision()).toEqual([
      { decision: null, user_id: 7 },
      { decision: null, user_id: null },
    ]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual([5, screen]);

    const kindScreen = lastId();
    await press(`admin_setkind:ok:facility:${id}:${pin}`, kindScreen);
    expect(sqlite.prepare("SELECT id FROM incoming_addresses WHERE id = ?").get(id)).toBeUndefined();
    expect(sqlite.prepare("SELECT text, kind FROM addresses").all()).toEqual([{ text: "5 New Street", kind: "facility" }]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual([5, screen, kindScreen, pin]);
    expect(of("sendLocation")[1].body.latitude).toBeCloseTo(53.405, 9);
    expect(of("sendLocation")[1].body.longitude).toBeCloseTo(-6.159, 9);
    expect(last().text).toBe("Incoming address 1 of 1\nParkside Drive\nLine (spot), from the walk");
  });
  it("Back on the kind screen shows the same address again", async () => {
    addIncoming("4 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    await press(`admin_kind:ok:${id}:9`);
    const kindScreen = lastId();
    await press(`admin_in:same:${id}:9`, kindScreen);
    expect(last().text).toContain("Incoming address 2 of 2\n5 New Street");
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([kindScreen, 9]));
    expect(decision()).toEqual([
      { decision: null, user_id: 7 },
      { decision: null, user_id: 7 },
    ]);
  });
  it("does not approve an address of a user without a kind, and takes only the four kinds", async () => {
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    await press(`admin_in:ok:${id}:9`);
    await press(`admin_setkind:ok:area:${id}:9`);
    await press(`admin_setkind:ok:temp:${id}:9`);
    expect(decision()).toEqual([{ decision: null, user_id: 7 }]);
    await press(`admin_in:no:${id}:9`);
    expect(decision()).toEqual([]);
  });
  it("approves an address of the walk without asking for a kind", async () => {
    const id = addIncoming("A", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_incoming");
    expect(keys()[0][0]).toBe(`admin_in:ok:${id}:${pinId()}`);
    await press(`admin_in:ok:${id}:${pinId()}`);
    expect(sqlite.prepare("SELECT id FROM incoming_addresses").all()).toEqual([]);
    expect(sqlite.prepare("SELECT text, kind FROM addresses").all()).toEqual([{ text: "A", kind: "house" }]);
  });
  it("rejects, and Next goes on without a decision", async () => {
    const a = addIncoming("A", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    const b = addIncoming("B", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    await press(`admin_in:next:${a}:1`);
    expect(last().text).toContain("Incoming address 2 of 2\nB");
    await press(`admin_in:no:${b}:1`);
    expect(sqlite.prepare("SELECT text, decision FROM incoming_addresses ORDER BY id").all()).toEqual([
      { text: "A", decision: null },
    ]);
    expect(last().text).toContain("Incoming address 1 of 1\nA");
  });
  const point = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });
  const groupOf = () => {
    const old = addAddress("4 Parkside Avenue", "point", 53.405, -6.16);
    const first = addIncoming("4 Parkside Avenue", "osm", point(-6.1599, 53.405));
    const second = addIncoming("4 parkside  avenue", "user", point(-6.1598, 53.405));
    return { old, first, second };
  };
  it("shows addresses with the same text as one group, a titled pin for each, and a Keep button for each", async () => {
    const { first } = groupOf();
    await press("admin_incoming", 5);
    expect(of("sendVenue").map((call) => [call.body.title, call.body.address])).toEqual([
      ["old", "4 Parkside Avenue"],
      ["new1", "4 Parkside Avenue"],
      ["new2", "4 Parkside Avenue"],
    ]);
    expect(last().text).toBe(
      "Incoming address 1 of 1\n4 Parkside Avenue\nSame address, 3 objects\nold: Point (house), in the directory\nnew1: Point (house), from OSM\nnew2: Point, written by a user",
    );
    expect(labels()).toEqual(["Keep old", "Keep new1", "Keep new2", "Reject all", "Next", "Approve all from the walk", "Back", "Approve all from OSM"]);
    expect(keys()).toEqual([
      ["admin_keep:0"],
      ["admin_keep:1"],
      [`admin_keepkind:2:${first}`],
      ["admin_rejectgroup"],
      [`admin_in:next:${first}:g`],
      ["admin_all_walk:g", "admin_back:g"],
      ["admin_all_osm:g"],
    ]);
    expect(sqlite.prepare("SELECT step, cleanup FROM drafts").all()).toEqual([
      { step: "admin_group", cleanup: JSON.stringify(of("sendVenue").map((call) => call.id)) },
    ]);
  });
  it("names several old addresses old1, old2", async () => {
    addAddress("4 Parkside Avenue", "point", 53.405, -6.16);
    addAddress("4 Parkside Avenue", "point", 53.406, -6.16);
    addIncoming("4 Parkside Avenue", "walk", point(-6.159, 53.405));
    await press("admin_incoming");
    expect(of("sendVenue").map((call) => call.body.title)).toEqual(["old1", "old2", "new1"]);
  });
  it("Keep old rejects every new address, deletes the other old ones and removes the screen with its pins", async () => {
    const { old } = groupOf();
    addAddress("4 Parkside Avenue", "point", 53.407, -6.16);
    await press("admin_incoming", 5);
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    await press("admin_keep:0", screen);
    expect(sqlite.prepare("SELECT id FROM addresses").all()).toEqual([{ id: old }]);
    expect(sqlite.prepare("SELECT id FROM incoming_addresses").all()).toEqual([]);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([screen, ...pins]));
    expect(last().text).toBe("No incoming addresses");
  });
  it("Keep new replaces the old address, keeping its ID, and rejects the other new ones", async () => {
    const { old } = groupOf();
    await press("admin_incoming");
    await press("admin_keep:1", lastId());
    expect(sqlite.prepare("SELECT id, geometry, source FROM addresses").all()).toEqual([
      { id: old, geometry: JSON.stringify(point(-6.1599, 53.405)), source: "osm" },
    ]);
    expect(sqlite.prepare("SELECT id FROM incoming_addresses").all()).toEqual([]);
  });
  it("Keep new of an address of a user asks for the kind, keeping the pins, and Back shows the group again", async () => {
    const { first } = groupOf();
    await press("admin_incoming", 5);
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    await press(`admin_keepkind:2:${first}`, screen);
    expect(last().text).toBe("Choose the kind");
    expect(keys()).toEqual([
      ["admin_keepset:2:house"],
      ["admin_keepset:2:appt"],
      ["admin_keepset:2:facility"],
      ["admin_keepset:2:spot"],
      [`admin_in:same:${first}:g`],
    ]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).not.toEqual(expect.arrayContaining(pins));
    const kindScreen = lastId();
    await press(`admin_in:same:${first}:g`, kindScreen);
    expect(last().text).toContain("Same address, 3 objects");
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([kindScreen, ...pins]));
    await press(`admin_keepkind:2:${first}`, lastId());
    await press("admin_keepset:2:appt", lastId());
    expect(sqlite.prepare("SELECT kind, source FROM addresses").all()).toEqual([{ kind: "appt", source: "user" }]);
    expect(sqlite.prepare("SELECT id FROM incoming_addresses").all()).toEqual([]);
  });
  it("Reject all rejects every new address, keeps the old ones and removes the screen with its pins", async () => {
    const { old } = groupOf();
    await press("admin_incoming", 5);
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    await press("admin_rejectgroup", screen);
    expect(sqlite.prepare("SELECT id FROM addresses").all()).toEqual([{ id: old }]);
    expect(sqlite.prepare("SELECT id FROM incoming_addresses").all()).toEqual([]);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([screen, ...pins]));
    expect(last().text).toBe("No incoming addresses");
  });
  it("does nothing for Keep new of an address of a user without a kind", async () => {
    groupOf();
    await press("admin_incoming");
    await press("admin_keep:2");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM addresses").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM incoming_addresses").get()).toEqual({ n: 2 });
  });
  it("a button of a group screen that is not the current one only gets its answer", async () => {
    groupOf();
    await press("admin_incoming", 5);
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    const before = sent.length;
    for (const data of ["admin_keep:0", "admin_rejectgroup", "admin_keepkind:2:1", "admin_keepset:2:appt", "admin_back:g", "admin_all_osm:g"]) {
      await press(data, screen - 50);
    }
    expect(sent.slice(before).map((call) => call.method)).toEqual(Array(6).fill("answerCallbackQuery"));
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM addresses").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM incoming_addresses WHERE decision IS NULL").get()).toEqual({ n: 2 });
    expect(sqlite.prepare("SELECT step, buttons_message_id, cleanup FROM drafts").all()).toEqual([
      { step: "admin_group", buttons_message_id: screen, cleanup: JSON.stringify(pins) },
    ]);
  });
  it("Reject all pressed twice decides only the group it was pressed on", async () => {
    groupOf();
    addAddress("7 Main St", "point", 53.405, -6.16);
    addIncoming("7 Main St", "walk", point(-6.1597, 53.405));
    await press("admin_incoming", 5);
    const screen = lastId();
    await press("admin_rejectgroup", screen);
    expect(last().text).toContain("7 Main St\nSame address, 2 objects");
    await press("admin_rejectgroup", screen);
    expect(sqlite.prepare("SELECT text FROM incoming_addresses WHERE decision IS NULL").all()).toEqual([{ text: "7 Main St" }]);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_group" }]);
  });
  it("a command removes the kind screen of a group together with the pins of the group", async () => {
    const { first } = groupOf();
    await press("admin_incoming", 5);
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    await press(`admin_keepkind:2:${first}`, screen);
    const kindScreen = lastId();
    expect(sqlite.prepare("SELECT step, buttons_message_id FROM drafts").all()).toEqual([
      { step: "admin_group", buttons_message_id: kindScreen },
    ]);
    await message({ text: "/manual" });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([kindScreen, ...pins]));
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drafts").get()).toEqual({ n: 0 });
  });
  it("a command removes the kind screen of a single address together with its pin", async () => {
    const id = addIncoming("5 New Street", "user", point(-6.16, 53.405));
    await press("admin_incoming", 5);
    const [screen, pin] = [lastId(), pinId()];
    await press(`admin_kind:ok:${id}:${pin}`, screen);
    const kindScreen = lastId();
    expect(sqlite.prepare("SELECT step, buttons_message_id, cleanup FROM drafts").all()).toEqual([
      { step: "screen", buttons_message_id: kindScreen, cleanup: JSON.stringify([pin]) },
    ]);
    await message({ text: "/manual" });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([kindScreen, pin]));
  });
  it("a screen remembered over a group draft that has expired keeps the group screen and its pins for a command", async () => {
    groupOf();
    await press("admin_incoming", 5);
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    sqlite.prepare("UPDATE drafts SET created_at = ?").run(Date.now() - 25 * 60 * 60 * 1000);
    await press("admin_back", 8);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
    await message({ text: "/manual" });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([screen, ...pins]));
  });
  it("removes the pins of a group when the next screen could not be sent", async () => {
    groupOf();
    await press("admin_incoming", 5);
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    failSend = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await press("admin_back:g", screen);
    const deleted = of("deleteMessage").map((call) => call.body.message_id);
    expect(deleted).toEqual(expect.arrayContaining(pins));
    expect(deleted).not.toContain(screen);
  });
  it("Approve all does not approve a group, and Next skips it with its pins removed", async () => {
    const { first } = groupOf();
    addIncoming("B", "osm", point(-6.16, 53.405));
    await press("admin_all_osm:77");
    expect(sqlite.prepare("SELECT text, decision FROM incoming_addresses ORDER BY id").all()).toEqual([
      { text: "4 Parkside Avenue", decision: null },
      { text: "4 parkside  avenue", decision: null },
    ]);
    expect(sqlite.prepare("SELECT text FROM addresses ORDER BY id").all()).toEqual([{ text: "4 Parkside Avenue" }, { text: "B" }]);
    expect(last().text).toContain("Incoming address 1 of 1\n4 Parkside Avenue\nSame address");
    const [screen, pins] = [lastId(), of("sendVenue").slice(-3).map((call) => call.id)];
    await press(`admin_in:next:${first}:g`, screen);
    expect(last().text).toContain("Incoming address 1 of 1\n4 Parkside Avenue");
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([screen, ...pins]));
  });
  it("Back on a group shows the admin screen and removes its pins", async () => {
    groupOf();
    await press("admin_incoming");
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    await press("admin_back:g", screen);
    expect(last().text).toContain("Admin console");
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([screen, ...pins]));
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
  });
  it("removes what is sent while a group is on screen and keeps the group", async () => {
    groupOf();
    await press("admin_incoming");
    await message({ text: "hello" });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toContain(500 + updateId);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_group" }]);
  });
  it("/admin while a group is on screen removes the screen and its pins", async () => {
    groupOf();
    await press("admin_incoming");
    const [screen, pins] = [lastId(), of("sendVenue").map((call) => call.id)];
    await message({ text: "/admin" });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([screen, ...pins]));
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
  });
  it("a question of a former version shows the directory screen", async () => {
    sqlite
      .prepare("INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (42, 'admin_location', 'x', 5, ?)")
      .run(Date.now());
    await message({ location: { latitude: 53.405, longitude: -6.16 } });
    expect(last().text).toContain("Directory");
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_search" }]);
  });
  it("an address screen that is no longer the current one does not move the directory draft", async () => {
    const ids = addRoads();
    await press("admin_directory");
    const list = lastId();
    await press("admin_directory");
    const current = lastId();
    await press(`admin_addr:${ids[0]}:0`, list);
    expect(sqlite.prepare("SELECT buttons_message_id FROM drafts").all()).toEqual([{ buttons_message_id: current }]);
  });
  it("approves all walk addresses at once and goes on with the rest", async () => {
    addIncoming("A", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    addIncoming("B", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_all_walk:77");
    expect(sqlite.prepare("SELECT text, decision FROM incoming_addresses ORDER BY id").all()).toEqual([
      { text: "B", decision: null },
    ]);
    expect(sqlite.prepare("SELECT text, kind FROM addresses").all()).toEqual([{ text: "A", kind: "house" }]);
    expect(last().text).toContain("Incoming address 1 of 1\nB");
    expect(of("deleteMessage").map((call) => call.body.message_id)).toContain(77);
  });
  it("approves all OSM addresses at once and leaves the walk addresses", async () => {
    addIncoming("A", "osm", { type: "Point", coordinates: [-6.16, 53.405] });
    addIncoming("B", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_all_osm:77");
    expect(sqlite.prepare("SELECT text, decision FROM incoming_addresses ORDER BY id").all()).toEqual([
      { text: "B", decision: null },
    ]);
    expect(sqlite.prepare("SELECT text, kind, source FROM addresses").all()).toEqual([{ text: "A", kind: "house", source: "osm" }]);
    expect(last().text).toContain("Incoming address 1 of 1\nB");
  });
  it("says that an incoming address comes from OSM", async () => {
    addIncoming("A", "osm", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_incoming");
    expect(last().text).toBe("Incoming address 1 of 1\nA\nPoint (house), from OSM");
  });
  it("Back removes the screen and its pin and shows the admin screen", async () => {
    await press("admin_back:77", 60);
    expect(last().text).toContain("Admin console");
    expect(of("deleteMessage").map((call) => call.body.message_id).sort()).toEqual([60, 77]);
  });
  const addRoads = () =>
    "ABCDEFGHIJKL".split("").map((letter, i) => addAddress(`${letter} Road`, "point", 53.405 + i * 0.00002, -6.16));
  it("lists the directory alphabetically by pages of ten, and the next page follows", async () => {
    const ids = addRoads();
    await press("admin_directory", 5);
    expect(last().text).toBe("Directory (page 1 of 2)\nSend a text to search");
    expect(labels()).toEqual(["A Road", "B Road", "C Road", "D Road", "E Road", "F Road", "G Road", "H Road", "I Road", "J Road", "Next", "Back"]);
    expect(keys()[0]).toEqual([`admin_addr:${ids[0]}:0`]);
    expect(keys().at(-2)).toEqual(["admin_list:1"]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual([5]);
    await press("admin_list:1", lastId());
    expect(last().text).toBe("Directory (page 2 of 2)\nSend a text to search");
    expect(labels()).toEqual(["K Road", "L Road", "Previous", "Back"]);
    expect(keys().at(-2)).toEqual(["admin_list:0"]);
    expect(sqlite.prepare("SELECT step, address FROM drafts").all()).toEqual([{ step: "admin_search", address: null }]);
  });
  it("has no page line when the directory fits on one page", async () => {
    addAddress("A Road", "point", 53.405, -6.16);
    await press("admin_directory");
    expect(last().text).toBe("Directory\nSend a text to search");
    expect(labels()).toEqual(["A Road", "Back"]);
  });
  it("searches by the text sent, finds a part of an address in any case, and the next text is a new search", async () => {
    addRoads();
    addAddress("4 Parkside Avenue", "point", 53.41, -6.16);
    await press("admin_directory", 5);
    const prompt = lastId();
    await message({ text: "  B ROAD " });
    expect(last().text).toBe("Found 1 address");
    expect(labels()).toEqual(["B Road", "Back"]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([prompt, 500 + updateId]));
    expect(sqlite.prepare("SELECT step, address FROM drafts").all()).toEqual([{ step: "admin_search", address: "B ROAD" }]);
    await message({ text: "road" });
    expect(last().text).toBe("Found 12 addresses (page 1 of 2)");
    await press("admin_list:1", lastId());
    expect(last().text).toBe("Found 12 addresses (page 2 of 2)");
    expect(labels()).toEqual(["K Road", "L Road", "Previous", "Back"]);
    await message({ text: "parkside" });
    expect(labels()).toEqual(["4 Parkside Avenue", "Back"]);
  });
  it("says when nothing is found, shows the whole directory on a blank text, and refuses a text that is too long", async () => {
    addAddress("A Road", "point", 53.405, -6.16);
    await press("admin_directory");
    await message({ text: "zzz" });
    expect(last().text).toBe("No addresses found");
    expect(labels()).toEqual(["Back"]);
    await message({ text: "   " });
    expect(last().text).toBe("Directory\nSend a text to search");
    expect(labels()).toEqual(["A Road", "Back"]);
    await message({ text: "x".repeat(49) });
    expect(last().text).toBe("The search text is too long");
    expect(labels()).toEqual(["Back"]);
    await message({ text: "road" });
    expect(labels()).toEqual(["A Road", "Back"]);
    await message({ location: { latitude: 53.405, longitude: -6.16 } });
    expect(labels()).toEqual(["A Road", "Back"]);
  });
  it("opens an address from the list, Back returns to the same page of the same search, and the text is edited", async () => {
    const ids = addRoads();
    await press("admin_directory");
    await message({ text: "road" });
    await press("admin_list:1", lastId());
    await press(`admin_addr:${ids[10]}:1`, lastId());
    expect(last().text).toBe("K Road\nPoint (house)");
    expect(labels()).toEqual(["Edit text", "Edit kind", "Move", "Delete", "Back"]);
    expect(keys()[1]).toEqual(["admin_list:1"]);
    await press("admin_list:1", lastId());
    expect(last().text).toBe("Found 12 addresses (page 2 of 2)");

    await press(`admin_addr:${ids[10]}:1`, lastId());
    await press(`admin_text:${ids[10]}`);
    expect(last().text).toBe("Write the new address");
    await message({ text: "x".repeat(101) });
    expect(last().text).toBe("The address must be 100 characters or less");
    await message({ text: "1A Main Street" });
    expect(of("sendMessage").slice(-2).map((call) => call.body.text)).toEqual([
      "Saved",
      "Admin console\nBot: on\nLast form check: none yet",
    ]);
    expect(sqlite.prepare("SELECT text FROM addresses WHERE id = ?").get(ids[10])).toEqual({ text: "1A Main Street" });
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
  });
  it("a text sent while an address is on screen is a new search and removes that screen", async () => {
    const [id] = addRoads();
    await press("admin_directory");
    await press(`admin_addr:${id}:0`, lastId());
    const screen = lastId();
    await message({ text: "road" });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toContain(screen);
    expect(last().text).toBe("Found 12 addresses (page 1 of 2)");
  });
  it("shows the whole directory when the list is asked for after the search draft is gone", async () => {
    addRoads();
    await press("admin_list:1");
    expect(last().text).toBe("Directory (page 2 of 2)\nSend a text to search");
  });
  it("moves a point to a new location and offers no Move for a line", async () => {
    const id = addAddress("1 Main Street", "point", 53.405, -6.16);
    const lineId = addAddress("Main Street", "line", 53.405, -6.16);
    await press(`admin_addr:${lineId}:0`);
    expect(labels()).toEqual(["Edit text", "Edit kind", "Delete", "Back"]);
    await press(`admin_move:${id}`);
    expect(last().text).toBe("Send the new location");
    await message({ text: "here" });
    expect(last().text).toBe("Send the new location");
    await message({ location: { latitude: 53.406, longitude: -6.161 } });
    expect(sqlite.prepare("SELECT geometry FROM addresses WHERE id = ?").get(id)).toEqual({
      geometry: JSON.stringify({ type: "Point", coordinates: [-6.161, 53.406] }),
    });
    expect(of("sendMessage").at(-2)?.body.text).toBe("Saved");
  });
  it("changes the kind of a directory address, and offers no Edit kind for an area", async () => {
    const id = addAddress("1 Main Street", "point", 53.405, -6.16);
    await press(`admin_editkind:${id}:2`);
    expect(last().text).toBe("Choose the kind");
    expect(keys()).toEqual([
      [`admin_dirkind:house:${id}`],
      [`admin_dirkind:appt:${id}`],
      [`admin_dirkind:facility:${id}`],
      [`admin_dirkind:spot:${id}`],
      [`admin_addr:${id}:2`],
    ]);
    await press(`admin_dirkind:appt:${id}`);
    expect(sqlite.prepare("SELECT kind FROM addresses WHERE id = ?").get(id)).toEqual({ kind: "appt" });
    expect(of("sendMessage").slice(-2).map((call) => call.body.text)).toEqual([
      "Saved",
      "Admin console\nBot: on\nLast form check: none yet",
    ]);
    await press(`admin_dirkind:area:${id}`);
    expect(sqlite.prepare("SELECT kind FROM addresses WHERE id = ?").get(id)).toEqual({ kind: "appt" });

    const area = Number(
      sqlite
        .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES ('Park', 'area', ?, 0, 0, 0, 0)")
        .run(JSON.stringify({ type: "Polygon", coordinates: [[[-6.16, 53.405], [-6.159, 53.405], [-6.159, 53.406], [-6.16, 53.405]]] }))
        .lastInsertRowid,
    );
    await press(`admin_addr:${area}:0`);
    expect(last().text).toBe("Park\nArea (area)");
    expect(labels()).toEqual(["Edit text", "Delete", "Back"]);
    await press(`admin_dirkind:spot:${area}`);
    expect(sqlite.prepare("SELECT kind FROM addresses WHERE id = ?").get(area)).toEqual({ kind: "area" });
  });
  it("deletes an address", async () => {
    const id = addAddress("1 Main Street", "point", 53.405, -6.16);
    await press(`admin_del:${id}`);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM addresses").get()).toEqual({ n: 0 });
    expect(of("sendMessage").slice(-2).map((call) => call.body.text)).toEqual([
      "Saved",
      "Admin console\nBot: on\nLast form check: none yet",
    ]);
  });
  it("Back on a question removes it, and a location afterwards starts a report", async () => {
    await press("admin_directory");
    await press("admin_back", lastId());
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await message({ location: { latitude: 53.0, longitude: -7.0 } });
    expect(last().text).toBe("Sorry, this bot doesn't work in this area");
  });
  it("Back on an old question leaves a newer one alone", async () => {
    await press("admin_directory");
    const old = lastId();
    await press("admin_directory");
    await press("admin_back", old);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_search" }]);
  });
  it("takes spaces and the postal district off an edited text, and asks again for a blank one", async () => {
    const id = addAddress("1 Main Street", "point", 53.405, -6.16);
    await press(`admin_text:${id}`);
    await message({ text: "   " });
    expect(last().text).toBe("Write the new address");
    await message({ text: "x".repeat(101) });
    expect(last().text).toBe("The address must be 100 characters or less");
    await message({ text: "   " });
    expect(last().text).toBe("Write the new address");
    await message({ text: "  1A Main Street, D13 " });
    expect(sqlite.prepare("SELECT text FROM addresses WHERE id = ?").get(id)).toEqual({ text: "1A Main Street" });
  });
  it("refuses to move a point outside the area and asks again", async () => {
    const id = addAddress("1 Main Street", "point", 53.405, -6.16);
    await press(`admin_move:${id}`);
    await message({ location: { latitude: 53.0, longitude: -7.0 } });
    expect(of("sendMessage").slice(-2).map((call) => call.body.text)).toEqual([
      "Sorry, this bot doesn't work in this area",
      "Send the new location",
    ]);
    expect(sqlite.prepare("SELECT geometry FROM addresses WHERE id = ?").get(id)).toEqual({
      geometry: JSON.stringify({ type: "Point", coordinates: [-6.16, 53.405] }),
    });
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_move" }]);
  });
  it("drops a question of /admin without a word for someone no longer an administrator", async () => {
    await press("admin_directory");
    status = "member";
    const count = sent.length;
    await message({ text: "road" });
    expect(sent.slice(count).map((call) => call.method)).toEqual(["deleteMessage"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drafts").get()).toEqual({ n: 0 });
  });

  describe("the lists of plates", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const START = Date.UTC(2026, 9, 1, 12);
    // The lists read the log of the last 66 days from the clock.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.UTC(2026, 10, 10, 12));
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const log = (plate: string, days: number, address: string, dLat = 0) =>
      sqlite
        .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon) VALUES (?, '', ?, 1, ?, ?, -6.1)")
        .run(START + days * DAY, plate, address, 53.4 + dLat);

    it("shows the repeat plates with the dates and the address of the last report", async () => {
      for (let i = 0; i < 5; i++) log("12-D-3456", i * 8, i === 4 ? "7 Main St" : "3 Main St", i * 0.01);
      for (let i = 0; i < 4; i++) log("99-D-1", i, "1 Main St");
      await press("admin_plates:repeat:0");
      expect(last().text).toBe("Repeat plates\n1. 12-D-3456, 5 reports, 01/10/2026 - 02/11/2026, 7 Main St");
      expect(keys()).toEqual([["admin_back"]]);
    });

    it("shows the cars that stayed at one spot for 33 days or more, the longest first", async () => {
      log("A-1", 0, "3 Main St");
      log("A-1", 33, "3 Main St", 0.0002);
      log("B-2", 0, "5 Main St");
      log("B-2", 40, "5 Main St");
      log("C-3", 0, "5 Main St");
      log("C-3", 32, "5 Main St");
      log("D-4", 0, "5 Main St");
      log("D-4", 20, "9 Main St", 0.01);
      log("D-4", 50, "5 Main St");
      await press("admin_plates:abandoned:0");
      expect(last().text).toBe(
        "Possibly abandoned cars\n1. B-2, 2 reports, 01/10/2026 - 10/11/2026, 5 Main St\n2. A-1, 2 reports, 01/10/2026 - 03/11/2026, 3 Main St",
      );
    });

    it("leaves out the reports older than 66 days", async () => {
      for (let i = 0; i < 4; i++) log("12-D-3456", 20 + i, "3 Main St");
      log("12-D-3456", -60, "3 Main St");
      log("A-1", -60, "5 Main St");
      log("A-1", 20, "5 Main St");
      await press("admin_plates:repeat:0");
      expect(last().text).toBe("No repeat plates");
      await press("admin_plates:abandoned:0");
      expect(last().text).toBe("No cars found");
    });

    it("takes the later row for the last report when two have the same time", async () => {
      for (const address of ["1 A St", "2 B St", "3 C St", "4 D St", "5 E St"]) log("12-D-3456", 3, address);
      await press("admin_plates:repeat:0");
      expect(last().text).toBe("Repeat plates\n1. 12-D-3456, 5 reports, 04/10/2026, 5 E St");
    });

    it("says so when a list is empty", async () => {
      await press("admin_plates:repeat:0");
      expect(last().text).toBe("No repeat plates");
      await press("admin_plates:abandoned:0");
      expect(last().text).toBe("No cars found");
      expect(keys()).toEqual([["admin_back"]]);
    });

    it("pages by ten with Previous and Next and keeps the numbers going", async () => {
      for (let i = 0; i < 12; i++) for (let j = 0; j < 5; j++) log(`P-${String(i).padStart(2, "0")}`, i + j, "3 Main St");
      await press("admin_plates:repeat:0");
      expect(last().text.split("\n")[0]).toBe("Repeat plates (page 1 of 2)");
      expect(last().text.split("\n")).toHaveLength(11);
      expect(keys()).toEqual([["admin_plates:repeat:1"], ["admin_back"]]);
      await press("admin_plates:repeat:1");
      expect(last().text.split("\n")[0]).toBe("Repeat plates (page 2 of 2)");
      expect(last().text.split("\n")[1].startsWith("11. ")).toBe(true);
      expect(keys()).toEqual([["admin_plates:repeat:0"], ["admin_back"]]);
    });

    it("gives a member who is not an administrator no answer", async () => {
      status = "member";
      await press("admin_plates:repeat:0");
      expect(of("sendMessage")).toHaveLength(0);
    });
  });
});

describe("/admin: the directory file", () => {
  let updateId = 0;
  let nextId = 0;
  let sent: { method: string; body: any; id: number }[] = [];
  let uploaded: string | Uint8Array | null = null;
  let duringDownload = () => {};
  beforeEach(() => {
    duringDownload = () => {};
    updateId = 0;
    nextId = 100;
    sent = [];
    uploaded = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const address = String(url);
        if (address.includes("/file/bot")) {
          duringDownload();
          return uploaded === null ? new Response("", { status: 404 }) : new Response(uploaded);
        }
        const method = address.split("/").pop() as string;
        if (method === "getChatMember") return new Response(JSON.stringify(memberOf("administrator")));
        if (method === "getFile") return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/file_1" } }));
        nextId += 1;
        if (init?.body instanceof FormData) {
          const document = init.body.get("document") as File;
          sent.push({ method, body: { chat_id: init.body.get("chat_id"), name: document.name, content: await document.text() }, id: nextId });
        } else {
          sent.push({ method, body: JSON.parse(String(init?.body)), id: nextId });
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: nextId } }));
      }),
    );
  });
  const of = (method: string) => sent.filter((call) => call.method === method);
  const texts = () => of("sendMessage").map((call) => call.body.text);
  const press = async (data: string, messageId = nextId) => {
    const update = privateButton(++updateId) as any;
    update.callback_query.data = data;
    update.callback_query.message.message_id = messageId;
    await send(update);
  };
  const message = async (fields: Record<string, unknown>) => {
    const update = privateMessage(++updateId) as any;
    Object.assign(update.message, { message_id: 500 + updateId, date: 1793000000, ...fields });
    await send(update);
  };
  const sendFile = (content: string | Uint8Array) => {
    uploaded = content;
    return message({ document: { file_id: "doc1", file_name: "map.geojson" } });
  };
  const collection = (...features: unknown[]) => JSON.stringify({ type: "FeatureCollection", features });
  const house = (address: string, lon: number) => ({
    type: "Feature",
    properties: { address, kind: "house" },
    geometry: { type: "Point", coordinates: [lon, 53.405] },
  });

  it("Export directory sends the directory as a file and the admin screen below it", async () => {
    sqlite
      .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north, source) VALUES (?, 'house', ?, 0, 0, 0, 0, 'osm')")
      .run("1 Main St", JSON.stringify({ type: "Point", coordinates: [-6.16, 53.405] }));
    await press("admin_export", 5);
    const [file] = of("sendDocument");
    expect(file.body.name).toBe("directory.geojson");
    expect(JSON.parse(file.body.content).features).toEqual([
      { type: "Feature", properties: { address: "1 Main St", kind: "house", source: "osm" }, geometry: { type: "Point", coordinates: [-6.16, 53.405] } },
    ]);
    expect(sent.map((call) => call.method)).toEqual(["answerCallbackQuery", "sendDocument", "sendMessage", "deleteMessage"]);
    expect(texts()).toEqual(["Admin console\nBot: on\nLast form check: none yet"]);
    expect(of("deleteMessage")[0].body.message_id).toBe(5);
  });

  it("Import file asks for the file, loads it and shows the incoming addresses", async () => {
    await press("admin_import", 5);
    expect(texts()).toEqual(["Send the edited file"]);
    const question = of("sendMessage")[0].id;
    await sendFile(collection(house("3 Main St", -6.1603)));
    expect(texts().slice(1)).toEqual(["Loaded 1 address, 0 unchanged skipped", "Incoming address 1 of 1\n3 Main St\nPoint (house), from the walk"]);
    expect(sqlite.prepare("SELECT source, text FROM incoming_addresses").all()).toEqual([{ source: "walk", text: "3 Main St" }]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([question, 500 + updateId]));
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "screen" }]);
  });

  it("asks for a document when something else is sent, or a file that is not GeoJSON", async () => {
    await press("admin_import", 5);
    await message({ text: "hello" });
    await sendFile("not json");
    expect(texts()).toEqual(["Send the edited file", "Send the file as a document", "Send the file as a document"]);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_import" }]);
  });

  it("skips a wrong feature, lists it and loads the others", async () => {
    await press("admin_import", 5);
    await sendFile(collection(house("", -6.16), house("4 Main St", -6.16)));
    expect(texts().at(-2)).toBe("Loaded 1 address, 0 unchanged skipped, 1 object with errors skipped\n\nObject 1: the address is missing");
    expect(sqlite.prepare("SELECT text FROM incoming_addresses").all()).toEqual([{ text: "4 Main St" }]);
  });

  it("asks for the file again when it cannot be downloaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await press("admin_import", 5);
    await message({ document: { file_id: "doc1" } });
    expect(texts()).toEqual(["Send the edited file", "Send the file as a document"]);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_import" }]);
  });

  it("loads nothing and shows nothing when the question is cancelled while the file downloads", async () => {
    await press("admin_import", 5);
    duringDownload = () => sqlite.exec("DELETE FROM drafts");
    const count = of("sendMessage").length;
    await sendFile(collection(house("3 Main St", -6.1603)));
    expect(of("sendMessage")).toHaveLength(count);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM incoming_addresses").get()).toEqual({ n: 0 });
  });

  it("asks for the file again when it is not valid UTF-8", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await press("admin_import", 5);
    const [before, after] = collection(house("3 Main X", -6.1603)).split("X");
    const encode = (text: string) => [...new TextEncoder().encode(text)];
    await sendFile(new Uint8Array([...encode(before), 0xff, ...encode(after)]));
    expect(texts().at(-1)).toBe("Send the file as a document");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM incoming_addresses").get()).toEqual({ n: 0 });
  });

  it("does not take a question that was asked again while the file downloaded", async () => {
    await press("admin_import", 5);
    duringDownload = () => sqlite.exec("UPDATE drafts SET buttons_message_id = 999");
    await sendFile(collection(house("3 Main St", -6.1603)));
    expect(sqlite.prepare("SELECT step, buttons_message_id FROM drafts").all()).toEqual([{ step: "admin_import", buttons_message_id: 999 }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM incoming_addresses").get()).toEqual({ n: 0 });
  });

  it("keeps the list of skipped objects within one message", async () => {
    await press("admin_import", 5);
    await sendFile(collection(...Array.from({ length: 200 }, (_, i) => ({ ...house(`${i} Main St`, -6.16), geometry: null }))));
    const text = texts().at(-2) as string;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.startsWith("Loaded 0 addresses, 0 unchanged skipped, 200 objects with errors skipped\n\nObject 1: ")).toBe(true);
  });
});
