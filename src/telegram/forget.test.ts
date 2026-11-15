import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { handleWebhook } from "./webhook";
import type { WebhookEnv } from "./webhook";

const NOW = Date.UTC(2026, 10, 15, 12);
const GROUP = "-100123";
const BOT = 4242;
const USER = 7;

let sqlite: ReturnType<typeof fakeD1>["sqlite"];
let env: WebhookEnv;
let calls: { method: string; body: Record<string, unknown> }[];
let status: string;
let pending: Promise<unknown>[];
let nextUpdate: number;
const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) } as unknown as ExecutionContext;

const called = (method: string) => calls.filter((call) => call.method === method).map((call) => call.body);
const methods = () => calls.map((call) => call.method);
const rows = (sql: string) => sqlite.prepare(sql).all();

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  pending = [];
  calls = [];
  status = "member";
  nextUpdate = 1;
  let nextMessage = 500;
  env = {
    AI: {} as Ai,
    DB: fake.db,
    TELEGRAM_BOT_TOKEN: `${BOT}:secret`,
    WEBHOOK_SECRET: "s3cret",
    GROUP_ID: GROUP,
    SITE_URL: "https://site.example",
    DIRECTORY_LINK_SECRET: "link-secret",
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = String(url).split("/").pop() as string;
      calls.push({ method, body: JSON.parse(String(init.body)) });
      if (method === "sendMessage") return new Response(JSON.stringify({ ok: true, result: { message_id: nextMessage++ } }));
      if (method === "getChatMember") {
        return new Response(JSON.stringify({ ok: true, result: { status, user: { id: USER, first_name: "Anna" } } }));
      }
      return new Response(JSON.stringify({ ok: true, result: true }));
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = async (update: Record<string, unknown>) => {
  await handleWebhook(
    new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
      body: JSON.stringify({ update_id: nextUpdate++, ...update }),
    }),
    env,
    ctx,
  );
  await Promise.all(pending);
};
const message = (text: string) => post({ message: { message_id: 1, date: NOW / 1000, text, chat: { id: USER, type: "private" }, from: { id: USER } } });
const press = (data: string, messageId: number) =>
  post({ callback_query: { id: "q", data, from: { id: USER }, message: { message_id: messageId, chat: { id: USER, type: "private" } } } });

// One row of every table that holds the user, and rows of another person that must stay.
function givenData(): void {
  const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...(args as never[]));
  run("INSERT INTO final_messages (chat_id, message_id, text, created_at) VALUES (?, 10, 'report', ?), (8, 11, 'other', ?)", USER, NOW, NOW);
  run("INSERT INTO user_phones (user_id, phone, reports, last_used_at) VALUES (?, 'android', 1, ?), (8, 'iphone', 1, ?)", USER, NOW, NOW);
  run("INSERT INTO feedback (user_id, text, created_at) VALUES (?, 'hello', ?), (8, 'other', ?)", USER, NOW, NOW);
  run("INSERT INTO invite_links (user_id, link, created_at) VALUES (?, 'https://t.me/+A', ?), (8, 'https://t.me/+B', ?)", USER, NOW, NOW);
  run(
    "INSERT INTO incoming_addresses (source, text, kind, geometry, user_id, created_at) VALUES ('user', '1 Main St', 'temp', '{}', ?, ?), ('user', '2 Main St', 'temp', '{}', 8, ?)",
    USER,
    NOW,
    NOW,
  );
  run(
    "INSERT INTO invites (invited_id, inviter_id, status, created_at) VALUES (?, 8, 'approved', 1), (9, ?, 'pending', 2), (10, 8, 'approved', 3)",
    USER,
    USER,
  );
  run("INSERT INTO invite_notices (chat_id, message_id, invited_id) VALUES (1, 100, ?), (1, 101, 9)", USER);
}

describe("/forget_me", () => {
  it("asks first, with Delete and Cancel, and changes nothing before Delete", async () => {
    givenData();
    await message("/forget_me");
    expect(called("sendMessage")).toEqual([
      {
        chat_id: USER,
        text: "Delete your data and remove you from the group? You can join again by invitation",
        reply_markup: { inline_keyboard: [[{ text: "Delete", callback_data: "forget_delete" }, { text: "Cancel", callback_data: "cancel" }]] },
      },
    ]);
    expect(rows("SELECT step FROM drafts")).toEqual([{ step: "forget_confirm" }]);
    expect(rows("SELECT user_id FROM user_phones ORDER BY user_id")).toEqual([{ user_id: USER }, { user_id: 8 }]);
  });

  it("deletes the data, replaces the user by the bot, writes to the user and then removes them without a ban", async () => {
    givenData();
    await message("/forget_me");
    calls = [];
    await press("forget_delete", 500);
    expect(rows("SELECT * FROM drafts")).toEqual([]);
    expect(rows("SELECT chat_id FROM final_messages")).toEqual([{ chat_id: 8 }]);
    expect(rows("SELECT user_id FROM user_phones")).toEqual([{ user_id: 8 }]);
    expect(rows("SELECT user_id FROM feedback")).toEqual([{ user_id: 8 }]);
    expect(rows("SELECT * FROM member_cache")).toEqual([]);
    expect(rows("SELECT user_id FROM invite_links")).toEqual([{ user_id: 8 }]);
    expect(rows("SELECT text, user_id FROM incoming_addresses ORDER BY id")).toEqual([
      { text: "1 Main St", user_id: BOT },
      { text: "2 Main St", user_id: 8 },
    ]);
    expect(rows("SELECT invited_id, inviter_id, status FROM invites ORDER BY id")).toEqual([
      { invited_id: BOT, inviter_id: 8, status: "approved" },
      { invited_id: 9, inviter_id: BOT, status: "pending" },
      { invited_id: 10, inviter_id: 8, status: "approved" },
    ]);
    expect(rows("SELECT message_id, invited_id FROM invite_notices ORDER BY message_id")).toEqual([
      { message_id: 100, invited_id: BOT },
      { message_id: 101, invited_id: 9 },
    ]);
    expect(called("deleteMessage")).toEqual([{ chat_id: USER, message_id: 500 }]);
    expect(called("sendMessage")).toEqual([
      { chat_id: USER, text: "Your data is deleted. You have been removed from the group" },
    ]);
    expect(called("revokeChatInviteLink")).toEqual([{ chat_id: GROUP, invite_link: "https://t.me/+A" }]);
    expect(called("banChatMember")).toEqual([{ chat_id: GROUP, user_id: USER }]);
    expect(called("unbanChatMember")).toEqual([{ chat_id: GROUP, user_id: USER, only_if_banned: true }]);
    const order = methods();
    expect(order.indexOf("sendMessage")).toBeLessThan(order.indexOf("banChatMember"));
    expect(order.indexOf("banChatMember")).toBeLessThan(order.indexOf("unbanChatMember"));
  });

  it("only deletes the data of an administrator and says the bot cannot remove them", async () => {
    status = "administrator";
    givenData();
    await message("/forget_me");
    calls = [];
    await press("forget_delete", 500);
    expect(rows("SELECT user_id FROM user_phones")).toEqual([{ user_id: 8 }]);
    expect(called("sendMessage")).toEqual([
      { chat_id: USER, text: "Your data is deleted. You are an admin, so the bot cannot remove you from the group" },
    ]);
    expect(called("banChatMember")).toEqual([]);
    expect(called("unbanChatMember")).toEqual([]);
  });

  it("does not unban when the ban failed", async () => {
    givenData();
    await message("/forget_me");
    const normal = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith("banChatMember") && !String(url).endsWith("unbanChatMember")) {
          calls.push({ method: "banChatMember", body: JSON.parse(String(init.body)) });
          return new Response(JSON.stringify({ ok: false, error_code: 400 }));
        }
        return normal(url, init);
      }),
    );
    await press("forget_delete", 500);
    expect(rows("SELECT user_id FROM user_phones")).toEqual([{ user_id: 8 }]);
    expect(called("unbanChatMember")).toEqual([]);
  });

  it("works on Delete without asking whether the user is still a member", async () => {
    givenData();
    await message("/forget_me");
    status = "left";
    calls = [];
    await press("forget_delete", 500);
    expect(rows("SELECT user_id FROM user_phones")).toEqual([{ user_id: 8 }]);
    expect(called("sendMessage").map((body) => body.text)).toEqual(["Your data is deleted. You have been removed from the group"]);
  });

  it("deletes once when Delete is pressed twice, and a Delete of an old screen does nothing", async () => {
    givenData();
    await message("/forget_me");
    await press("forget_delete", 499);
    expect(rows("SELECT user_id FROM user_phones ORDER BY user_id")).toEqual([{ user_id: USER }, { user_id: 8 }]);
    await press("forget_delete", 500);
    calls = [];
    await press("forget_delete", 500);
    expect(called("sendMessage")).toEqual([]);
    expect(called("banChatMember")).toEqual([]);
  });

  it("Cancel only removes the screen, without Report cancelled", async () => {
    givenData();
    await message("/forget_me");
    calls = [];
    await press("cancel", 500);
    expect(called("deleteMessage")).toEqual([{ chat_id: USER, message_id: 500 }]);
    expect(called("sendMessage")).toEqual([]);
    expect(rows("SELECT * FROM drafts")).toEqual([]);
    expect(rows("SELECT user_id FROM user_phones ORDER BY user_id")).toEqual([{ user_id: USER }, { user_id: 8 }]);
  });

  it("revokes nothing when the user has no invite link", async () => {
    await message("/forget_me");
    await press("forget_delete", 500);
    expect(called("revokeChatInviteLink")).toEqual([]);
    expect(called("banChatMember")).toHaveLength(1);
  });

  it("goes away with another command, like any screen", async () => {
    await message("/forget_me");
    calls = [];
    await message("/help");
    expect(called("deleteMessage")).toEqual([{ chat_id: USER, message_id: 500 }]);
    expect(rows("SELECT * FROM drafts")).toEqual([]);
  });

  it("is not answered for a person who is not a member", async () => {
    status = "left";
    await message("/forget_me");
    expect(called("sendMessage")).toEqual([]);
    expect(rows("SELECT * FROM drafts")).toEqual([]);
  });
});
