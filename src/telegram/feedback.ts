// The feedback of the users, written for the administrators of the closed group.

export interface FeedbackItem {
  id: number;
  userId: number;
  text: string;
  createdAt: number;
  // The place of the item among all the feedback, oldest first, and the number of items.
  position: number;
  total: number;
}

export async function saveFeedback(db: D1Database, userId: number, text: string): Promise<void> {
  await db
    .prepare("INSERT INTO feedback (user_id, text, created_at) VALUES (?1, ?2, ?3)")
    .bind(userId, text, Date.now())
    .run();
}

const FEEDBACK_AFTER = `SELECT id, user_id AS userId, text, created_at AS createdAt,
    (SELECT COUNT(*) FROM feedback AS earlier WHERE earlier.id <= feedback.id) AS position,
    (SELECT COUNT(*) FROM feedback) AS total
  FROM feedback WHERE id > ?1 ORDER BY id LIMIT 1`;

// The oldest item after afterId, or the first one when there is none after it; null when there is no feedback.
export async function nextFeedback(db: D1Database, afterId: number): Promise<FeedbackItem | null> {
  const found = await db.prepare(FEEDBACK_AFTER).bind(afterId).first<FeedbackItem>();
  if (found || afterId <= 0) return found;
  return db.prepare(FEEDBACK_AFTER).bind(0).first<FeedbackItem>();
}

export async function deleteFeedback(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM feedback WHERE id = ?1").bind(id).run();
}
