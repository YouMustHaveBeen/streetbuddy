import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import { INVITE_LINK_TTL_MS, decideJoin, handleJoinRequest, inviteLink, listApprovedInvites } from "./invite";
import { handleWebhook } from "./webhook";
import type { WebhookEnv } from "./webhook";

const NOW = Date.UTC(2026, 10, 11, 12);
const GROUP = "-100123";
const LINK = "https://t.me/+AbCdEf";

let sqlite: ReturnType<typeof fakeD1>["sqlite"];
let env: WebhookEnv;
let calls: { method: string; body: Record<string, unknown> }[];
let answers: Record<string, unknown>;
let pending: Promise<unknown>[];
const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) } as unknown as ExecutionContext;

const called = (method: string) => calls.filter((call) => call.method === method).map((call) => call.body);
const rows = (sql: string) => sqlite.prepare(sql).all();

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  pending = [];
  calls = [];
  let nextMessage = 100;
  answers = {
    getChatMember: { status: "member", user: { id: 7, first_name: "Maria", last_name: "Smith", username: "maria" } },
    getChatAdministrators: [
      { user: { id: 1, is_bot: false } },
      { user: { id: 2, is_bot: false } },
      { user: { id: 999, is_bot: true } },
    ],
    createChatInviteLink: { invite_link: LINK },
  };
  env = {
    AI: {} as Ai,
    DB: fake.db,
    TELEGRAM_BOT_TOKEN: "token",
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
      if (method in answers) return new Response(JSON.stringify({ ok: true, result: answers[method] }));
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

const request = (overrides: Record<string, unknown> = {}) => ({
  chat: { id: Number(GROUP) },
  from: { id: 50, first_name: "Anna", last_name: "Kowalski", username: "anna" },
  invite_link: { invite_link: LINK },
  ...overrides,
});

const givenLink = () =>
  sqlite.prepare("INSERT INTO invite_links (user_id, link, created_at) VALUES (7, ?, ?)").run(LINK, NOW);

describe("inviteLink", () => {
  it("creates a link that asks for approval and lasts 7 days, and keeps it", async () => {
    expect(await inviteLink(env, 7, NOW)).toBe(LINK);
    expect(called("createChatInviteLink")).toEqual([
      { chat_id: GROUP, expire_date: Math.floor((NOW + INVITE_LINK_TTL_MS) / 1000), creates_join_request: true },
    ]);
    expect(rows("SELECT user_id, link, created_at FROM invite_links")).toEqual([{ user_id: 7, link: LINK, created_at: NOW }]);
  });

  it("gives the same link while it is valid, without asking Telegram", async () => {
    await inviteLink(env, 7, NOW);
    calls = [];
    expect(await inviteLink(env, 7, NOW + INVITE_LINK_TTL_MS - 1)).toBe(LINK);
    expect(calls).toEqual([]);
  });

  it("makes a new link when the old one has expired, and replaces it", async () => {
    await inviteLink(env, 7, NOW);
    answers.createChatInviteLink = { invite_link: "https://t.me/+New" };
    expect(await inviteLink(env, 7, NOW + INVITE_LINK_TTL_MS)).toBe("https://t.me/+New");
    expect(rows("SELECT link FROM invite_links")).toEqual([{ link: "https://t.me/+New" }]);
  });

  it("gives null and stores nothing when Telegram does not create the link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 400 }))));
    expect(await inviteLink(env, 7, NOW)).toBeNull();
    expect(rows("SELECT * FROM invite_links")).toEqual([]);
  });
});

describe("handleJoinRequest", () => {
  it("records the request and sends every administrator that is not a bot the message with the buttons", async () => {
    givenLink();
    await handleJoinRequest(env, 1, request());
    expect(rows("SELECT invited_id, inviter_id, status, created_at FROM invites")).toEqual([
      { invited_id: 50, inviter_id: 7, status: "pending", created_at: NOW },
    ]);
    const text = "Join request\nAnna Kowalski @anna wants to join the group\nInvited by Maria Smith @maria";
    const buttons = [
      [
        { text: "Approve", callback_data: `admin_join:ok:50:${NOW}` },
        { text: "Reject", callback_data: `admin_join:no:50:${NOW}` },
      ],
    ];
    expect(called("sendMessage")).toEqual([
      { chat_id: 1, text, reply_markup: { inline_keyboard: buttons } },
      { chat_id: 2, text, reply_markup: { inline_keyboard: buttons } },
    ]);
    expect(rows("SELECT chat_id, message_id, invited_id FROM invite_notices ORDER BY chat_id")).toEqual([
      { chat_id: 1, message_id: 100, invited_id: 50 },
      { chat_id: 2, message_id: 101, invited_id: 50 },
    ]);
  });

  it("writes the Telegram ID when there is no @username, and unknown user when Telegram does not give the inviter", async () => {
    givenLink();
    delete answers.getChatMember;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const method = String(url).split("/").pop() as string;
        calls.push({ method, body: JSON.parse(String(init.body)) });
        if (method === "getChatMember") return new Response(JSON.stringify({ ok: false, error_code: 400 }));
        if (method === "getChatAdministrators") return new Response(JSON.stringify({ ok: true, result: [{ user: { id: 1 } }] }));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }));
      }),
    );
    await handleJoinRequest(env, 1, request({ from: { id: 50, first_name: "Tom" } }));
    expect(called("sendMessage")[0].text).toBe("Join request\nTom 50 wants to join the group\nInvited by unknown user 7");
  });

  it("handles an update only once", async () => {
    givenLink();
    await handleJoinRequest(env, 1, request());
    calls = [];
    await handleJoinRequest(env, 1, request());
    expect(calls).toEqual([]);
  });

  it("leaves a request by a link that is not in the table to Telegram", async () => {
    await handleJoinRequest(env, 1, request());
    expect(rows("SELECT * FROM invites")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("ignores a request to another chat, without a link or without the person", async () => {
    givenLink();
    await handleJoinRequest(env, 1, request({ chat: { id: -100999 } }));
    await handleJoinRequest(env, 2, request({ invite_link: undefined }));
    await handleJoinRequest(env, 3, request({ from: undefined }));
    expect(rows("SELECT * FROM invites")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("keeps the notices of the administrators who were sent the message, and none when nobody was", async () => {
    givenLink();
    answers.getChatAdministrators = [];
    await handleJoinRequest(env, 1, request());
    expect(rows("SELECT * FROM invite_notices")).toEqual([]);
    expect(rows("SELECT status FROM invites")).toEqual([{ status: "pending" }]);
  });

  it("takes the buttons off the messages about an earlier request of the same person", async () => {
    givenLink();
    await handleJoinRequest(env, 1, request());
    calls = [];
    vi.setSystemTime(NOW + 1000);
    await handleJoinRequest(env, 2, request());
    expect(called("editMessageReplyMarkup")).toEqual([
      { chat_id: 1, message_id: 100, reply_markup: { inline_keyboard: [] } },
      { chat_id: 2, message_id: 101, reply_markup: { inline_keyboard: [] } },
    ]);
    expect(rows("SELECT chat_id, message_id FROM invite_notices")).toEqual([
      { chat_id: 1, message_id: 102 },
      { chat_id: 2, message_id: 103 },
    ]);
    expect(rows("SELECT created_at FROM invites")).toEqual([{ created_at: NOW + 1000 }]);
  });

  it.each([[true], [false]])(
    "finishes the messages that a decision made during the sending did not find (approve: %s)",
    async (approve) => {
      givenLink();
      const normal = globalThis.fetch;
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        if (String(url).endsWith("/sendMessage") && JSON.parse(String(init.body)).chat_id === 2) await held;
        return normal(url as string, init);
      });
      const running = handleJoinRequest(env, 1, request());
      await vi.waitFor(() => expect(called("sendMessage")).toHaveLength(1));
      const text = String(called("sendMessage")[0].text);
      await decideJoin(env, 50, NOW, approve, { chatId: 1, messageId: 100, text });
      release();
      await running;
      const outcome = approve ? "Approved" : "Rejected";
      // The pressed message is changed by the decision and again with the rest; the repeat changes nothing.
      const edits = called("editMessageText").map((body) => [body.chat_id, body.text]);
      expect(edits).toEqual([
        [1, `${text}\n${outcome}`],
        [1, `${text}\n${outcome}`],
        [2, `${text}\n${outcome}`],
      ]);
      expect(rows("SELECT * FROM invite_notices")).toEqual([]);
    },
  );

  it("is reached from the webhook by a chat_join_request update", async () => {
    givenLink();
    const response = await handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
        body: JSON.stringify({ update_id: 5, chat_join_request: request() }),
      }),
      env,
      ctx,
    );
    await Promise.all(pending);
    expect(response.status).toBe(200);
    expect(rows("SELECT invited_id FROM invites")).toEqual([{ invited_id: 50 }]);
  });
});

describe("decideJoin", () => {
  const TEXT = "Join request\nAnna Kowalski @anna wants to join the group\nInvited by Maria Smith @maria";
  const pendingRequest = () => {
    sqlite.prepare("INSERT INTO invites (invited_id, inviter_id, status, created_at) VALUES (50, 7, 'pending', ?)").run(NOW);
    sqlite.prepare("INSERT INTO invite_notices (chat_id, message_id, invited_id) VALUES (1, 100, 50), (2, 101, 50)").run();
  };

  it("approves: stores the decision, approves in Telegram and changes the message of every administrator", async () => {
    pendingRequest();
    await decideJoin(env, 50, NOW, true, { chatId: 1, messageId: 100, text: TEXT });
    expect(rows("SELECT status FROM invites")).toEqual([{ status: "approved" }]);
    expect(called("approveChatJoinRequest")).toEqual([{ chat_id: GROUP, user_id: 50 }]);
    const edited = { text: `${TEXT}\nApproved`, reply_markup: { inline_keyboard: [] } };
    expect(called("editMessageText")).toEqual([
      { chat_id: 1, message_id: 100, ...edited },
      { chat_id: 2, message_id: 101, ...edited },
    ]);
    expect(rows("SELECT * FROM invite_notices")).toEqual([]);
  });

  it("rejects: keeps the record marked rejected and declines in Telegram", async () => {
    pendingRequest();
    await decideJoin(env, 50, NOW, false, { chatId: 2, messageId: 101, text: TEXT });
    expect(rows("SELECT status FROM invites")).toEqual([{ status: "rejected" }]);
    expect(called("declineChatJoinRequest")).toEqual([{ chat_id: GROUP, user_id: 50 }]);
    expect(called("editMessageText").map((body) => body.text)).toEqual([`${TEXT}\nRejected`, `${TEXT}\nRejected`]);
  });

  it("changes the message that was pressed even when its notice was not stored", async () => {
    sqlite.prepare("INSERT INTO invites (invited_id, inviter_id, status, created_at) VALUES (50, 7, 'pending', ?)").run(NOW);
    await decideJoin(env, 50, NOW, true, { chatId: 1, messageId: 100, text: TEXT });
    expect(called("editMessageText").map((body) => body.message_id)).toEqual([100]);
  });

  it("only takes the buttons off when Telegram does not give the text of the pressed message", async () => {
    pendingRequest();
    await decideJoin(env, 50, NOW, true, { chatId: 1, messageId: 100 });
    expect(called("approveChatJoinRequest")).toHaveLength(1);
    expect(called("editMessageText")).toEqual([]);
    expect(called("editMessageReplyMarkup").map((body) => [body.chat_id, body.message_id])).toEqual([
      [1, 100],
      [2, 101],
    ]);
  });

  it("does nothing for a request that is already decided or unknown", async () => {
    pendingRequest();
    await decideJoin(env, 50, NOW, true, { chatId: 1, messageId: 100, text: TEXT });
    calls = [];
    await decideJoin(env, 50, NOW, false, { chatId: 2, messageId: 101, text: TEXT });
    await decideJoin(env, 77, NOW, true, { chatId: 1, messageId: 100, text: TEXT });
    expect(calls).toEqual([]);
    expect(rows("SELECT status FROM invites")).toEqual([{ status: "approved" }]);
  });

  it("does nothing when the button belongs to an earlier request of the same person", async () => {
    pendingRequest();
    await decideJoin(env, 50, NOW - 1, true, { chatId: 1, messageId: 100, text: TEXT });
    expect(calls).toEqual([]);
    expect(rows("SELECT status FROM invites")).toEqual([{ status: "pending" }]);
  });

  it("is reached by the admin button, which only administrators can use", async () => {
    pendingRequest();
    const press = (userId: number) =>
      handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
          body: JSON.stringify({
            update_id: userId,
            callback_query: {
              id: "cb",
              data: `admin_join:ok:50:${NOW}`,
              from: { id: userId },
              message: { message_id: 100, text: TEXT, chat: { id: userId, type: "private" } },
            },
          }),
        }),
        env,
        ctx,
      );
    answers.getChatMember = { status: "member", user: { id: 3, first_name: "Joe" } };
    await press(3);
    await Promise.all(pending);
    expect(rows("SELECT status FROM invites")).toEqual([{ status: "pending" }]);
    answers.getChatMember = { status: "administrator", user: { id: 1, first_name: "Admin" } };
    await press(1);
    await Promise.all(pending);
    expect(rows("SELECT status FROM invites")).toEqual([{ status: "approved" }]);
  });
});

describe("listApprovedInvites", () => {
  it("lists only the approved ones, oldest first", async () => {
    const add = (invited: number, inviter: number, status: string, at: number) =>
      sqlite.prepare("INSERT INTO invites (invited_id, inviter_id, status, created_at) VALUES (?, ?, ?, ?)").run(invited, inviter, status, at);
    add(10, 1, "approved", 30);
    add(11, 1, "pending", 20);
    add(12, 2, "rejected", 10);
    add(13, 2, "approved", 5);
    expect(await listApprovedInvites(env.DB)).toEqual([
      { invitedId: 13, inviterId: 2 },
      { invitedId: 10, inviterId: 1 },
    ]);
  });
});

describe("/invite and the Invites screen", () => {
  const send = async (update: Record<string, unknown>) => {
    await handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
        body: JSON.stringify(update),
      }),
      env,
      ctx,
    );
    await Promise.all(pending);
  };
  const command = (updateId: number, text: string) => ({
    update_id: updateId,
    message: { message_id: 1, text, chat: { id: 7, type: "private" }, from: { id: 7 } },
  });

  it("gives a member the link with the text, without a link preview", async () => {
    await send(command(1, "/invite"));
    const [sent] = called("sendMessage");
    expect(sent.chat_id).toBe(7);
    expect(sent.text).toBe(
      `Your invite link works for 7 days. The person you send it to joins the group after an administrator approves the request\n\n${LINK}`,
    );
    expect(sent.link_preview_options).toEqual({ is_disabled: true });
    expect(rows("SELECT user_id, link FROM invite_links")).toEqual([{ user_id: 7, link: LINK }]);
  });

  it("answers that the link could not be created", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const method = String(url).split("/").pop() as string;
        calls.push({ method, body: JSON.parse(String(init.body)) });
        if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: "member" } }));
        if (method === "createChatInviteLink") return new Response(JSON.stringify({ ok: false, error_code: 400 }));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      }),
    );
    await send(command(1, "/invite"));
    expect(called("sendMessage")[0].text).toBe("Could not create the link. Please try again in a minute");
  });

  it("gives nothing to a person who is not a member", async () => {
    answers.getChatMember = { status: "left" };
    await send(command(1, "/invite"));
    expect(called("sendMessage")).toEqual([]);
    expect(called("createChatInviteLink")).toEqual([]);
  });

  it("shows the approved invitations as `invited (inviter)`, numbered, with Back", async () => {
    sqlite.prepare("INSERT INTO invites (invited_id, inviter_id, status, created_at) VALUES (50, 7, 'approved', 1), (51, 7, 'pending', 2)").run();
    answers.getChatMember = { status: "administrator", user: { id: 7, first_name: "Maria", last_name: "Smith", username: "maria" } };
    await send({
      update_id: 1,
      callback_query: {
        id: "cb",
        data: "admin_invites:0",
        from: { id: 7 },
        message: { message_id: 9, chat: { id: 7, type: "private" } },
      },
    });
    const [screen] = called("sendMessage");
    expect(screen.text).toBe("Invites\n1. Maria Smith @maria (Maria Smith @maria)");
    expect(screen.reply_markup).toEqual({ inline_keyboard: [[{ text: "Back", callback_data: "admin_back" }]] });
  });

  it("says there are no invites yet", async () => {
    answers.getChatMember = { status: "administrator", user: { id: 7, first_name: "Maria" } };
    await send({
      update_id: 1,
      callback_query: { id: "cb", data: "admin_invites:0", from: { id: 7 }, message: { message_id: 9, chat: { id: 7, type: "private" } } },
    });
    expect(called("sendMessage")[0].text).toBe("No invites yet");
  });

  it("cuts the list into pages of 10 and numbers them through", async () => {
    const insert = sqlite.prepare("INSERT INTO invites (invited_id, inviter_id, status, created_at) VALUES (?, 7, 'approved', ?)");
    for (let i = 1; i <= 12; i++) insert.run(100 + i, i);
    answers.getChatMember = { status: "administrator", user: { id: 7, first_name: "Maria" } };
    await send({
      update_id: 1,
      callback_query: { id: "cb", data: "admin_invites:1", from: { id: 7 }, message: { message_id: 9, chat: { id: 7, type: "private" } } },
    });
    const [screen] = called("sendMessage");
    expect(String(screen.text).split("\n")).toEqual(["Invites (page 2 of 2)", "11. Maria 111 (Maria 7)", "12. Maria 112 (Maria 7)"]);
  });
});
