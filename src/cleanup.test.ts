import { describe, expect, it, vi } from "vitest";
import { fakeD1 } from "../test/fakeD1";
import { cleanupExpired } from "./cleanup";
import worker from "./index";
import type { Env } from "./index";

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
  it("runs the cleanup", async () => {
    const { db, sqlite } = fakeD1();
    sqlite.prepare("INSERT INTO processed_updates (update_id, created_at) VALUES (1, 0)").run();
    await worker.scheduled(SCHEDULED, { DB: db } as Env, {} as ExecutionContext);
    expect(rows(sqlite, "SELECT update_id FROM processed_updates")).toEqual([]);
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
