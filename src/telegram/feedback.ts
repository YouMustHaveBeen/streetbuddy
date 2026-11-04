// The feedback of the users, written for the administrators of the closed group.

export async function saveFeedback(db: D1Database, userId: number, text: string): Promise<void> {
  await db
    .prepare("INSERT INTO feedback (user_id, text, created_at) VALUES (?1, ?2, ?3)")
    .bind(userId, text, Date.now())
    .run();
}
