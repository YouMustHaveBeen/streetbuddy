import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleWebhook } from "./webhook";
import type { WebhookEnv } from "./webhook";

// Minimal D1 on top of SQLite, running the real migration.
function fakeD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0002_processed_updates.sql", "utf8"));
  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...(args as never[])).changes) } }),
    }),
  });
  const count = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM processed_updates").get() as { n: number }).n;
  return { db: { prepare } as unknown as D1Database, count };
}

const SECRET = "s3cret";
let env: WebhookEnv;
let rows: () => number;
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
  const fake = fakeD1();
  rows = fake.count;
  pending = [];
  env = { DB: fake.db, TELEGRAM_BOT_TOKEN: "token", WEBHOOK_SECRET: SECRET, GROUP_ID: "-100123" };
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
  it("lets nobody in and says nothing when Telegram fails the check", async () => {
    const mock = telegram({ ok: false, error_code: 400 });
    expect((await send(privateMessage())).status).toBe(200);
    expect(methods(mock)).toEqual(["getChatMember"]);
  });
});
