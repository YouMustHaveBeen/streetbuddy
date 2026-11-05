// The phone a user has chosen: it decides the steps shown in the final message.
import { REPORT_LOG_TTL_MS } from "../core/stats";

export const PHONE_TTL_MS = REPORT_LOG_TTL_MS;

export const PHONES = ["iphone_bookmark", "iphone_userscripts", "android"] as const;

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
