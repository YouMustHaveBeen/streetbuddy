// The phone a user has chosen: it decides the steps shown in the final message.
import { DAY_MS, TWO_MONTHS_MS } from "../core/shared";

export const PHONE_TTL_MS = TWO_MONTHS_MS;
// After this many days without a link or a choice of phone a user counts as inactive.
export const INACTIVE_DAYS = 53;

export const PHONES = ["iphone", "android"] as const;

export type Phone = (typeof PHONES)[number];

export interface UserPhone {
  phone: Phone;
  reports: number;
}

export async function readPhone(db: D1Database, userId: number): Promise<UserPhone | null> {
  return db
    .prepare("SELECT phone, reports FROM user_phones WHERE user_id = ?1 AND last_used_at > ?2")
    .bind(userId, Date.now() - PHONE_TTL_MS)
    .first<UserPhone>();
}

// Stores the choice and starts the count of links over.
export async function savePhone(db: D1Database, userId: number, phone: Phone): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO user_phones (user_id, phone, reports, last_used_at) VALUES (?1, ?2, 0, ?3)")
    .bind(userId, phone, Date.now())
    .run();
}

export async function countReport(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare("UPDATE user_phones SET reports = reports + 1, last_used_at = ?2 WHERE user_id = ?1")
    .bind(userId, Date.now())
    .run();
}

// Users that have just become inactive: the last use was INACTIVE_DAYS ago, within the last day.
export async function listInactiveUsers(db: D1Database, now: number): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT user_id FROM user_phones WHERE last_used_at <= ?1 AND last_used_at > ?2 ORDER BY user_id")
    .bind(now - INACTIVE_DAYS * DAY_MS, now - (INACTIVE_DAYS + 1) * DAY_MS)
    .all<{ user_id: number }>();
  return results.map((row) => row.user_id);
}
