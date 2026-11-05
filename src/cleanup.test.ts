import { dublinDay } from "./core";
import { describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../test/fakeD1";
import { cleanupExpired } from "./cleanup";
import worker from "./index";
import type { Env } from "./env";

const NOW = 10_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const GEOCODE_TTL = 60 * DAY;
// Noon in Dublin, so the daily form check does not run in these tests.
const SCHEDULED = { scheduledTime: Date.UTC(2026, 11, 15, 12, 0) } as ScheduledController;

// Ages (ms before NOW) of the rows to insert: older than the term, exactly at it, newer than it.
function seed(sqlite: ReturnType<typeof fakeD1>["sqlite"], ttl: number) {
  const ages = [ttl + 1, ttl, ttl - 1];
  ages.forEach((age, i) => {
    const createdAt = NOW - age;
    sqlite
      .prepare("INSERT INTO drafts (user_id, step, prompt, buttons_message_id, created_at) VALUES (?, 'address', 'x', 1, ?)")
      .run(i, createdAt);
    sqlite
      .prepare("INSERT INTO plate_cache (file_unique_id, plates, created_at) VALUES (?, '[]', ?)")
      .run(`f${i}`, createdAt);
    sqlite
      .prepare("INSERT INTO processed_updates (update_id, created_at) VALUES (?, ?)")
      .run(i, createdAt);
    sqlite
      .prepare("INSERT INTO geocode_cache (key, address, lat, lon, created_at) VALUES (?, 'a', 1, 2, ?)")
      .run(`k${i}`, createdAt);
    sqlite
      .prepare("INSERT INTO final_messages (chat_id, message_id, text, created_at) VALUES (1, ?, 'x', ?)")
      .run(i, createdAt);
    sqlite
      .prepare("INSERT INTO report_log (id, created_at, plate, parking, address, lat, lon) VALUES (?, ?, 'p', 1, 'a', 1, 2)")
      .run(i, createdAt);
    sqlite
      .prepare("INSERT INTO feedback (id, user_id, text, created_at) VALUES (?, 1, 'x', ?)")
      .run(i, createdAt);
  });
}

const rows = (sqlite: ReturnType<typeof fakeD1>["sqlite"], sql: string) =>
  sqlite.prepare(sql).all().map((row) => Object.values(row)[0]);

describe("cleanupExpired", () => {
  it("removes drafts, recognition cache and processed updates older than 24 hours", async () => {
    const { db, sqlite } = fakeD1();
    seed(sqlite, DAY);
    await cleanupExpired(db, NOW);
    expect(rows(sqlite, "SELECT user_id FROM drafts")).toEqual([2]);
    expect(rows(sqlite, "SELECT file_unique_id FROM plate_cache")).toEqual(["f2"]);
    expect(rows(sqlite, "SELECT update_id FROM processed_updates")).toEqual([2]);
    // Texts of final messages live for 48 hours, so none of these is past its term yet.
    expect(rows(sqlite, "SELECT message_id FROM final_messages ORDER BY message_id")).toEqual([0, 1, 2]);
  });

  it("removes texts of final messages older than 48 hours and keeps the rest", async () => {
    const { db, sqlite } = fakeD1();
    seed(sqlite, 2 * DAY);
    await cleanupExpired(db, NOW);
    expect(rows(sqlite, "SELECT message_id FROM final_messages")).toEqual([2]);
  });

  it("removes log lines and feedback older than 60 days and keeps the rest", async () => {
    const { db, sqlite } = fakeD1();
    seed(sqlite, GEOCODE_TTL);
    await cleanupExpired(db, NOW);
    expect(rows(sqlite, "SELECT id FROM report_log")).toEqual([2]);
    expect(rows(sqlite, "SELECT id FROM feedback")).toEqual([2]);
  });

  it("removes cached addresses older than 60 days and keeps the rest", async () => {
    const { db, sqlite } = fakeD1();
    seed(sqlite, GEOCODE_TTL);
    await cleanupExpired(db, NOW);
    expect(rows(sqlite, "SELECT key FROM geocode_cache")).toEqual(["k2"]);
  });

  it("keeps rows of the other tables that are older than 24 hours but not past their own term", async () => {
    const { db, sqlite } = fakeD1();
    sqlite
      .prepare("INSERT INTO geocode_cache (key, address, lat, lon, created_at) VALUES ('k', 'a', 1, 2, ?)")
      .run(NOW - 30 * DAY);
    await cleanupExpired(db, NOW);
    expect(rows(sqlite, "SELECT key FROM geocode_cache")).toEqual(["k"]);
  });

  it("does nothing on empty tables", async () => {
    const { db } = fakeD1();
    await expect(cleanupExpired(db, NOW)).resolves.toBeUndefined();
  });
});

describe("scheduled", () => {
  // 3:00 in Dublin in winter, and in summer (when it is 2:00 UTC).
  const NIGHT_WINTER = { scheduledTime: Date.UTC(2026, 11, 15, 3, 0) } as ScheduledController;
  const NIGHT_SUMMER = { scheduledTime: Date.UTC(2026, 6, 15, 2, 0) } as ScheduledController;
  const OTHER_RUN = { scheduledTime: Date.UTC(2026, 11, 15, 2, 0) } as ScheduledController;
  const logLine = (sqlite: ReturnType<typeof fakeD1>["sqlite"], createdAt: number) =>
    sqlite
      .prepare("INSERT INTO report_log (created_at, day, plate, parking, address, lat, lon) VALUES (?, ?, 'p', 1, 'a', 53.4, -6.1)")
      .run(createdAt, dublinDay(createdAt));

  it("counts the statistics in the run that is 3:00 in Dublin, winter or summer", async () => {
    for (const run of [NIGHT_WINTER, NIGHT_SUMMER]) {
      // The cleanup that runs first goes by the clock, so the clock is set to the run.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(run.scheduledTime);
      try {
        const { db, sqlite } = fakeD1();
        logLine(sqlite, run.scheduledTime - 12 * 60 * 60 * 1000);
        await worker.scheduled(run, { DB: db } as Env, {} as ExecutionContext);
        expect(rows(sqlite, "SELECT reports FROM daily_stats")).toEqual([1]);
        expect(rows(sqlite, "SELECT plates FROM hotspots")).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("does not count them in the other run of the pair", async () => {
    const { db, sqlite } = fakeD1();
    logLine(sqlite, OTHER_RUN.scheduledTime - 12 * 60 * 60 * 1000);
    await worker.scheduled(OTHER_RUN, { DB: db } as Env, {} as ExecutionContext);
    expect(rows(sqlite, "SELECT day FROM daily_stats")).toEqual([]);
  });

  it("logs a failed count and does not throw", async () => {
    const { db, sqlite } = fakeD1();
    sqlite.exec("DROP TABLE hotspots");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(worker.scheduled(NIGHT_WINTER, { DB: db } as Env, {} as ExecutionContext)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("scheduled: statistics failed", expect.any(Error));
    log.mockRestore();
  });

  it("runs the cleanup", async () => {
    const { db, sqlite } = fakeD1();
    sqlite.prepare("INSERT INTO processed_updates (update_id, created_at) VALUES (1, 0)").run();
    await worker.scheduled(SCHEDULED, { DB: db } as Env, {} as ExecutionContext);
    expect(rows(sqlite, "SELECT update_id FROM processed_updates")).toEqual([]);
  });

  it("closes the final messages past 48 hours before the cleanup removes their texts", async () => {
    const { db, sqlite } = fakeD1();
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ method: String(url).split("/").pop() as string, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SCHEDULED.scheduledTime);
    try {
      sqlite
        .prepare("INSERT INTO final_messages (chat_id, message_id, text, created_at) VALUES (7, 9, 'Vehicle 12-D-3456', 0)")
        .run();
      await worker.scheduled(SCHEDULED, { DB: db, TELEGRAM_BOT_TOKEN: "token" } as Env, {} as ExecutionContext);
      expect(calls).toEqual([
        {
          method: "editMessageText",
          body: { chat_id: 7, message_id: 9, text: "Vehicle 12-D-3456", reply_markup: { inline_keyboard: [] } },
        },
      ]);
      expect(rows(sqlite, "SELECT message_id FROM final_messages")).toEqual([]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("does not throw when the cleanup fails", async () => {
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      worker.scheduled(SCHEDULED, { DB: db } as Env, {} as ExecutionContext),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("scheduled: cleanup failed", expect.any(Error));
    log.mockRestore();
  });
});
