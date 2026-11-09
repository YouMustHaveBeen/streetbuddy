import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../../test/fakeD1";
import type { Env } from "../env";
import { notifyInactiveUsers } from "./notify";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 9, 6);
const HEADER = "Inactive for 53 days, their Telegram ID is deleted in a week";

let sqlite: ReturnType<typeof fakeD1>["sqlite"];
let env: Env;
let sent: { chat_id: string; text: string }[];
// What getChatMember answers for each user ID; a missing user gets an error.
let members: Record<number, { first_name: string; last_name?: string; username?: string }>;

const phone = (userId: number, daysAgo: number) =>
  sqlite.prepare("INSERT INTO user_phones (user_id, phone, reports, last_used_at) VALUES (?, 'android', 0, ?)").run(userId, NOW - daysAgo * DAY);

beforeEach(() => {
  const fake = fakeD1();
  sqlite = fake.sqlite;
  env = { DB: fake.db, TELEGRAM_BOT_TOKEN: "token", OWNER_TELEGRAM_ID: "111", GROUP_ID: "-100222" } as Env;
  sent = [];
  members = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (String(url).endsWith("/getChatMember")) {
        const user = members[body.user_id];
        return new Response(JSON.stringify(user ? { ok: true, result: { status: "member", user } } : { ok: false, error_code: 400 }));
      }
      sent.push(body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notifyInactiveUsers", () => {
  it("sends the owner one message with the users who became inactive in the last day", async () => {
    phone(1, 53);
    phone(2, 53.5);
    phone(3, 52);
    phone(4, 54.5);
    phone(5, 1);
    members = {
      1: { first_name: "Anna", last_name: "K.", username: "anna" },
      2: { first_name: "Tom" },
    };
    await notifyInactiveUsers(env, NOW);
    expect(sent).toEqual([{ chat_id: "111", text: `${HEADER}\nAnna K. (@anna)\nTom` }]);
  });

  it("sends nothing when nobody became inactive", async () => {
    phone(1, 10);
    await notifyInactiveUsers(env, NOW);
    expect(sent).toEqual([]);
  });

  it("leaves out a user that Telegram does not give and logs the number", async () => {
    phone(1, 53);
    phone(2, 53);
    members = { 2: { first_name: "Tom", username: "tom" } };
    await notifyInactiveUsers(env, NOW);
    expect(sent).toEqual([{ chat_id: "111", text: `${HEADER}\nTom (@tom)` }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("1 of 2"));
  });

  it("sends nothing when Telegram gives none of them", async () => {
    phone(1, 53);
    await notifyInactiveUsers(env, NOW);
    expect(sent).toEqual([]);
  });

  it("splits a list that does not fit in one message, each part with the header", async () => {
    const name = "N".repeat(200);
    for (let id = 1; id <= 30; id++) {
      phone(id, 53);
      members[id] = { first_name: name };
    }
    await notifyInactiveUsers(env, NOW);
    expect(sent.length).toBeGreaterThan(1);
    for (const message of sent) {
      expect(message.text.length).toBeLessThanOrEqual(4096);
      expect(message.text.startsWith(HEADER)).toBe(true);
    }
    expect(sent.reduce((count, message) => count + message.text.split("\n").length - 1, 0)).toBe(30);
  });
});
