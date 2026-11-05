// Removal of expired rows from D1, run by the scheduled handler.
import { GEOCODE_CACHE_TTL_MS } from "./core/geocode";
import { DAY_MS } from "./core/shared";
import { REPORT_LOG_TTL_MS } from "./core/stats";
import { FINAL_MESSAGE_TTL_MS } from "./telegram/draft";

// A row is expired when created_at is at or before the cutoff. One batch, one round trip.
export async function cleanupExpired(db: D1Database, now: number = Date.now()): Promise<void> {
  const dayAgo = now - DAY_MS;
  await db.batch([
    db.prepare("DELETE FROM drafts WHERE created_at <= ?1").bind(dayAgo),
    db.prepare("DELETE FROM plate_cache WHERE created_at <= ?1").bind(dayAgo),
    db.prepare("DELETE FROM processed_updates WHERE created_at <= ?1").bind(dayAgo),
    db.prepare("DELETE FROM geocode_cache WHERE created_at <= ?1").bind(now - GEOCODE_CACHE_TTL_MS),
    db.prepare("DELETE FROM final_messages WHERE created_at <= ?1").bind(now - FINAL_MESSAGE_TTL_MS),
    db.prepare("DELETE FROM report_log WHERE created_at <= ?1").bind(now - REPORT_LOG_TTL_MS),
    db.prepare("DELETE FROM feedback WHERE created_at <= ?1").bind(now - REPORT_LOG_TTL_MS),
  ]);
}
