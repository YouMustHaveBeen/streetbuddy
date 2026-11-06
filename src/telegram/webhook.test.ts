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
const ADMIN_ROW = [
  { text: "Feedback", callback_data: "admin_feedback" },
  { text: "Statistics", callback_data: "admin_statistics" },
];
const ADDRESS_ROW = [
  { text: "Incoming addresses", callback_data: "admin_incoming" },
  { text: "Edit directory", callback_data: "admin_directory" },
];
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
  env = { AI: {} as Ai, DB: fake.db, TELEGRAM_BOT_TOKEN: "token", WEBHOOK_SECRET: SECRET, GROUP_ID: "-100123", SITE_URL: "https://site.example" };
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
  it.each([[memberOf("left")], [memberOf("kicked")], [memberOf("restricted", false)]])(
    "tells %j it is members only",
    async (answer) => {
      const mock = telegram(answer);
      await send(privateMessage(1, 42));
      expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
      expect(bodyOf(mock, "sendMessage")).toEqual({
        chat_id: 42,
        text: "This bot is only for members of the group",
      });
    },
  );
  it("does not check membership on an ordinary button", async () => {
    const mock = telegram(memberOf("left"));
    const press = privateButton() as any;
    press.callback_query.data = "cancel";
    await send(press);
    expect(methods(mock)).toEqual(["answerCallbackQuery"]);
  });
  it("gives a non-member a pop-up instead of the link and keeps the draft", async () => {
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
    expect(bodyOf(mock, "answerCallbackQuery")).toEqual({
      callback_query_id: "cb1",
      text: "This bot is only for members of the group",
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
      reply_markup: { inline_keyboard: [[{ text: "Switch off", callback_data: "admin_off" }], ADMIN_ROW, ADDRESS_ROW] },
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
      reply_markup: { inline_keyboard: [[{ text: "Switch on", callback_data: "admin_on" }], ADMIN_ROW, ADDRESS_ROW] },
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
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drafts").get()).toEqual({ n: 0 });
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
  it("leaves a report of another user alone", async () => {
    const mock = adminTelegram("administrator");
    sqlite
      .prepare(
        "INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (77, 'address', 'x', 5, ?)",
      )
      .run(Date.now());
    await send(textMessage("/admin"));
    expect(methods(mock)).toEqual(["getChatMember", "sendMessage"]);
    expect(sqlite.prepare("SELECT user_id FROM drafts").all()).toEqual([{ user_id: 77 }]);
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
      reply_markup: { inline_keyboard: [[{ text: "Switch on", callback_data: "admin_on" }], ADMIN_ROW, ADDRESS_ROW] },
    });
    expect(bodyOf(mock, "deleteMessage")).toEqual({ chat_id: 42, message_id: OLD_SCREEN_ID });
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
  it("answers the Feedback and Statistics buttons and does nothing else", async () => {
    for (const data of ["admin_feedback", "admin_statistics"]) {
      const mock = adminTelegram("administrator");
      await send(adminButton(data));
      expect(methods(mock)).toEqual(["getChatMember", "answerCallbackQuery"]);
      expect(enabled()).toBe(1);
      pending = [];
      vi.unstubAllGlobals();
      sqlite.prepare("DELETE FROM processed_updates").run();
    }
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
      "map:today",
      "map:week",
      "map:last_month",
      "map:month_before",
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
    "admin_statistics",
    "admin_incoming",
    "admin_directory",
    "admin_in:ok:1:2",
    "admin_all_walk",
    "admin_back",
    "admin_addr:1",
    "admin_text:1",
    "admin_move:1",
    "admin_del:1",
    "review_ok",
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
  beforeEach(() => {
    updateId = 0;
    nextId = 100;
    sent = [];
    status = "administrator";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const method = String(url).split("/").pop() as string;
        if (method === "getChatMember") return new Response(JSON.stringify(memberOf(status)));
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
        .run(source, text, (geometry as any).type === "Point" ? "point" : "line", JSON.stringify(geometry), source === "user" ? 7 : null)
        .lastInsertRowid,
    );
  const addAddress = (text: string, kind: string, lat: number, lon: number) =>
    Number(
      sqlite
        .prepare("INSERT INTO addresses (text, kind, geometry, west, south, east, north) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          text,
          kind,
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
      [`admin_in:ok:${id}:${pin}`, `admin_in:no:${id}:${pin}`, `admin_in:next:${id}:${pin}`],
      [`admin_all_walk:${pin}`, `admin_back:${pin}`],
    ]);
    expect(labels()).toEqual(["Approve", "Reject", "Next", "Approve all from the walk", "Back"]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual([5]);
  });
  it("approves, removes the screen and its pin and shows the next one, with its line in the middle", async () => {
    const id = addIncoming("5 New Street", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    addIncoming("Parkside Drive", "walk", { type: "LineString", coordinates: [[-6.16, 53.405], [-6.158, 53.405]] });
    await press("admin_incoming", 5);
    const [screen, pin] = [lastId(), pinId()];
    await press(`admin_in:ok:${id}:${pin}`, screen);
    expect((decision() as any[])[0]).toEqual({ decision: "approved", user_id: null });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual([5, screen, pin]);
    expect(of("sendLocation")[1].body.latitude).toBeCloseTo(53.405, 9);
    expect(of("sendLocation")[1].body.longitude).toBeCloseTo(-6.159, 9);
    expect(last().text).toBe("Incoming address 1 of 1\nParkside Drive\nLine, from the walk");
  });
  it("rejects, and Next goes on without a decision", async () => {
    const a = addIncoming("A", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    const b = addIncoming("B", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    await press(`admin_in:next:${a}:1`);
    expect(last().text).toContain("Incoming address 2 of 2\nB");
    await press(`admin_in:no:${b}:1`);
    expect(sqlite.prepare("SELECT text, decision FROM incoming_addresses ORDER BY id").all()).toEqual([
      { text: "A", decision: null },
      { text: "B", decision: "rejected" },
    ]);
    expect(last().text).toContain("Incoming address 1 of 1\nA");
  });
  it("offers Keep old and Replace old when the text is already in the directory", async () => {
    addAddress("a", "point", 53.405 + 40 / 111195, -6.16);
    const id = addIncoming("A", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_incoming");
    expect(last().text).toBe(
      "Incoming address 1 of 1\nA\nPoint, from the walk\nPossible duplicate: the same address is in the directory 40 m away",
    );
    expect(labels()).toEqual(["Keep old", "Replace old", "Next", "Approve all from the walk", "Back"]);
    const [screen, pin] = [lastId(), pinId()];
    await press(`admin_in:replace:${id}:${pin}`, screen);
    expect(decision()).toEqual([{ decision: "replace", user_id: null }]);
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([screen, pin]));
    expect(last().text).toBe("No incoming addresses");
    expect(labels()).toEqual(["Back"]);
  });
  it("Keep old drops the new address", async () => {
    const id = addIncoming("A", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    await press(`admin_in:keep:${id}:101`);
    expect(decision()).toEqual([{ decision: "rejected", user_id: null }]);
  });
  it("approves all walk addresses at once and goes on with the rest", async () => {
    addIncoming("A", "walk", { type: "Point", coordinates: [-6.16, 53.405] });
    addIncoming("B", "user", { type: "Point", coordinates: [-6.16, 53.405] });
    await press("admin_all_walk:77");
    expect(sqlite.prepare("SELECT text, decision FROM incoming_addresses ORDER BY id").all()).toEqual([
      { text: "A", decision: "approved" },
      { text: "B", decision: null },
    ]);
    expect(last().text).toContain("Incoming address 1 of 1\nB");
    expect(of("deleteMessage").map((call) => call.body.message_id)).toContain(77);
  });
  it("Back removes the screen and its pin and shows the admin screen", async () => {
    await press("admin_back:77", 60);
    expect(last().text).toContain("Admin console");
    expect(of("deleteMessage").map((call) => call.body.message_id).sort()).toEqual([60, 77]);
  });
  it("finds directory addresses by location, five at most, and edits the text of one", async () => {
    const ids = [1, 2, 3, 4, 5, 6].map((i) => addAddress(`${i} Main Street`, "point", 53.405 + i * 0.00002, -6.16));
    await press("admin_directory", 5);
    expect(last().text).toBe("Send the location of the address");
    expect(labels()).toEqual(["Back"]);
    const prompt = lastId();
    await message({ location: { latitude: 53.405, longitude: -6.16 } });
    expect(of("deleteMessage").map((call) => call.body.message_id)).toEqual(expect.arrayContaining([prompt, 500 + updateId]));
    expect(last().text).toBe("Choose the address");
    expect(labels()).toEqual(["1 Main Street", "2 Main Street", "3 Main Street", "4 Main Street", "5 Main Street", "Back"]);

    await press(`admin_addr:${ids[0]}`);
    expect(last().text).toBe("1 Main Street\nPoint");
    expect(labels()).toEqual(["Edit text", "Move", "Delete", "Back"]);
    await press(`admin_text:${ids[0]}`);
    expect(last().text).toBe("Write the new address");
    await message({ text: "x".repeat(101) });
    expect(last().text).toBe("The address must be 100 characters or less");
    await message({ text: "1A Main Street" });
    expect(of("sendMessage").slice(-2).map((call) => call.body.text)).toEqual([
      "Saved",
      "Admin console\nBot: on\nLast form check: none yet",
    ]);
    expect(sqlite.prepare("SELECT text FROM addresses WHERE id = ?").get(ids[0])).toEqual({ text: "1A Main Street" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drafts").get()).toEqual({ n: 0 });
  });
  it("says when there is nothing within 30 m", async () => {
    await press("admin_directory");
    await message({ location: { latitude: 53.405, longitude: -6.16 } });
    expect(last().text).toBe("No addresses within 30 m");
    expect(labels()).toEqual(["Back"]);
  });
  it("moves a point to a new location and offers no Move for a line", async () => {
    const id = addAddress("1 Main Street", "point", 53.405, -6.16);
    const lineId = addAddress("Main Street", "line", 53.405, -6.16);
    await press(`admin_addr:${lineId}`);
    expect(labels()).toEqual(["Edit text", "Delete", "Back"]);
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
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drafts").get()).toEqual({ n: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await message({ location: { latitude: 53.0, longitude: -7.0 } });
    expect(last().text).toBe("Sorry, this bot doesn't work in this area");
  });
  it("Back on an old question leaves a newer one alone", async () => {
    await press("admin_directory");
    const old = lastId();
    await press("admin_directory");
    await press("admin_back", old);
    expect(sqlite.prepare("SELECT step FROM drafts").all()).toEqual([{ step: "admin_location" }]);
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
    await message({ location: { latitude: 53.405, longitude: -6.16 } });
    expect(sent.slice(count).map((call) => call.method)).toEqual(["deleteMessage"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drafts").get()).toEqual({ n: 0 });
  });
});
