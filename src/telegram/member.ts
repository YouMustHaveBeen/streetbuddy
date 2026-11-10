// Members of the group who are not administrators, remembered for a short time in D1.

// How long a remembered member is let in without asking Telegram.
export const MEMBER_CACHE_TTL_MS = 60 * 60 * 1000;

// The statement that finds the user among the remembered members.
export const rememberedMember = (db: D1Database, userId: number, now: number): D1PreparedStatement =>
  db
    .prepare("SELECT 1 AS found FROM member_cache WHERE user_id = ?1 AND checked_at > ?2")
    .bind(userId, now - MEMBER_CACHE_TTL_MS);

// Remembers a member who is not an administrator; anyone else who was remembered is forgotten.
// A failure is only logged.
export async function updateMemberCache(
  db: D1Database,
  userId: number,
  access: { member: boolean; admin: boolean },
  remembered: boolean,
  now: number,
): Promise<void> {
  try {
    if (access.member && !access.admin) {
      await db.prepare("INSERT OR REPLACE INTO member_cache (user_id, checked_at) VALUES (?1, ?2)").bind(userId, now).run();
    } else if (remembered) {
      await db.prepare("DELETE FROM member_cache WHERE user_id = ?1").bind(userId).run();
    }
  } catch {
    console.error("Remembering a member failed");
  }
}
