// Removal of expired rows from D1, run by the scheduled handler.
import { GEOCODE_CACHE_TTL_MS } from "./core/geocode";
import { REPORT_LOG_TTL_MS } from "./core/stats";
import { DRAFT_TTL_MS, FINAL_MESSAGE_TTL_MS } from "./telegram/draft";

// A row is expired when created_at is at or before the cutoff, which is the opposite of the
// `created_at > now - TTL` check the bot uses when it reads drafts and the recognition cache.
// Tables are small and bounded, so the deletes scan them: an index on created_at would only
// make every write to processed_updates (one per Telegram update) more expensive.
// final_messages loses a row with every press of Done or Cancel, so it stays small too.
// report_log and feedback hold two months of a small district, so they are scanned as well.
// One batch: 7 statements in a single round trip.
export async function cleanupExpired(db: D1Database, now: number = Date.now()): Promise<void> {
  const dayAgo = now - DRAFT_TTL_MS;
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
