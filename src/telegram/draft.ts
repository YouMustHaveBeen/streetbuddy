// The report draft in D1. An album arrives as separate updates handled at the same time,
// so everything that can change concurrently is written by single atomic statements.

// Lifetime of drafts and of the recognition cache. The scheduled cleanup also removes processed
// update IDs at this age, although the webhook does not check their age when it filters repeats.
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// Lifetime of the stored text of a final message, which Done needs to rewrite the message.
export const FINAL_MESSAGE_TTL_MS = 48 * 60 * 60 * 1000;

export interface Draft {
  user_id: number;
  step: Step;
  prompt: string;
  buttons_message_id: number;
  cleanup: string;
  failures: number;
  address: string | null;
  lat: number | null;
  lon: number | null;
  first_message_id: number | null;
  first_file_id: string | null;
  first_file_unique_id: string | null;
  first_photo_at: number | null;
  last_photo_id: number | null;
  photo_count: number;
  plates: string | null;
  plate: string | null;
  time: string | null;
  parking: number;
  created_at: number;
}

export type Step =
  | "location" // Address lookup failed, waiting for a new location or address.
  | "address_text" // Coordinates are known, waiting for the address as text.
  | "address"
  | "address_edit"
  | "photos"
  | "recognizing"
  | "plate_choice"
  | "plate_input"
  | "plate_time"
  | "time_input"
  | "parking"
  | "finishing";

export type DraftChanges = Partial<
  Pick<Draft, "step" | "failures" | "address" | "lat" | "lon" | "plate" | "time">
>;

// Adds message IDs to the JSON list; ?N is the JSON array of the new ones.
const appendCleanup = (param: string) =>
  `cleanup = (SELECT json_group_array(value) FROM
    (SELECT value FROM json_each(drafts.cleanup) UNION ALL SELECT value FROM json_each(${param})))`;

// An expired row counts as no draft.
export async function loadDraft(db: D1Database, userId: number): Promise<Draft | null> {
  return db
    .prepare("SELECT * FROM drafts WHERE user_id = ?1 AND created_at > ?2")
    .bind(userId, Date.now() - DRAFT_TTL_MS)
    .first<Draft>();
}

export async function createDraft(
  db: D1Database,
  userId: number,
  messageId: number,
  prompt: string,
  changes: DraftChanges,
  cleanupIds: number[],
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO drafts
       (user_id, step, prompt, buttons_message_id, cleanup, failures, address, lat, lon, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      userId,
      changes.step,
      prompt,
      messageId,
      JSON.stringify(cleanupIds),
      changes.failures ?? 0,
      changes.address ?? null,
      changes.lat ?? null,
      changes.lon ?? null,
      Date.now(),
    )
    .run();
}

// Puts the just sent message in place of the previous one, only if the draft is still on
// the expected step. Returns the previous message ID, or null when the step has moved on
// and the just sent message is the one that is out of place.
export async function swapScreen(
  db: D1Database,
  userId: number,
  expectedStep: Step,
  messageId: number,
  prompt: string,
  changes: DraftChanges,
  cleanupIds: number[],
): Promise<number | null> {
  const columns = Object.keys(changes) as (keyof DraftChanges)[];
  const sets = columns.map((column, i) => `${column} = ?${i + 6}`);
  const update = db
    .prepare(
      `UPDATE drafts SET buttons_message_id = ?3, prompt = ?4, ${appendCleanup("?5")}
       ${sets.map((set) => `, ${set}`).join("")}
       WHERE user_id = ?1 AND step = ?2`,
    )
    .bind(
      userId,
      expectedStep,
      messageId,
      prompt,
      JSON.stringify(cleanupIds),
      ...columns.map((column) => changes[column] ?? null),
    );
  const select = db
    .prepare("SELECT buttons_message_id FROM drafts WHERE user_id = ?1 AND step = ?2")
    .bind(userId, expectedStep);
  // A batch is one transaction, so no other screen can slip in between the two statements.
  const [previous, updated] = await db.batch<{ buttons_message_id: number }>([select, update]);
  return updated.meta.changes > 0 ? (previous.results[0]?.buttons_message_id ?? null) : null;
}

export async function addCleanup(db: D1Database, userId: number, ids: number[]): Promise<void> {
  await db
    .prepare(`UPDATE drafts SET ${appendCleanup("?2")} WHERE user_id = ?1`)
    .bind(userId, JSON.stringify(ids))
    .run();
}

export async function recordPhoto(
  db: D1Database,
  userId: number,
  photo: { fileId: string; fileUniqueId: string; sentAt: number; messageId: number },
): Promise<{ photoCount: number; isFirst: boolean } | null> {
  // Album photos can reach the database in any order, so the first photo is the one with
  // the lowest message ID. When it changes, the plates of the previous one no longer count.
  const earlier = "first_message_id IS NULL OR ?5 < first_message_id";
  const row = await db
    .prepare(
      `UPDATE drafts SET
         first_file_id = CASE WHEN ${earlier} THEN ?2 ELSE first_file_id END,
         first_file_unique_id = CASE WHEN ${earlier} THEN ?3 ELSE first_file_unique_id END,
         first_photo_at = CASE WHEN ${earlier} THEN ?4 ELSE first_photo_at END,
         plates = CASE WHEN ${earlier} THEN NULL ELSE plates END,
         first_message_id = CASE WHEN ${earlier} THEN ?5 ELSE first_message_id END,
         last_photo_id = MAX(COALESCE(last_photo_id, 0), ?5),
         photo_count = photo_count + 1
       WHERE user_id = ?1 AND step = 'photos'
       RETURNING photo_count, first_message_id`,
    )
    .bind(userId, photo.fileId, photo.fileUniqueId, photo.sentAt, photo.messageId)
    .first<{ photo_count: number; first_message_id: number }>();
  if (!row) return null;
  return { photoCount: row.photo_count, isFirst: row.first_message_id === photo.messageId };
}

// The result counts only for the photo the draft is waiting for: recognition can finish
// after a cancel, or after an earlier album photo has taken over as the first one.
export async function setPlates(
  db: D1Database,
  userId: number,
  fileUniqueId: string,
  plates: string[],
): Promise<void> {
  await db
    .prepare("UPDATE drafts SET plates = ?3 WHERE user_id = ?1 AND first_file_unique_id = ?2")
    .bind(userId, fileUniqueId, JSON.stringify(plates))
    .run();
}

// Moves the draft to another step; false means someone else got there first.
export async function moveStep(
  db: D1Database,
  userId: number,
  from: Step,
  to: Step,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE drafts SET step = ?3 WHERE user_id = ?1 AND step = ?2")
    .bind(userId, from, to)
    .run();
  return result.meta.changes > 0;
}

// Takes the report for giving the link and returns the parking options as they are at that
// moment: a tap on an option can land after the draft was loaded. Null means someone else
// got there first.
export async function startFinishing(db: D1Database, userId: number): Promise<number | null> {
  const row = await db
    .prepare(
      "UPDATE drafts SET step = 'finishing' WHERE user_id = ?1 AND step = 'parking' RETURNING parking",
    )
    .bind(userId)
    .first<{ parking: number }>();
  return row?.parking ?? null;
}

// Flips one bit in a single statement: quick taps must not overwrite each other.
export async function toggleParking(
  db: D1Database,
  userId: number,
  bit: number,
): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE drafts SET parking = (parking | ?2) - (parking & ?2)
       WHERE user_id = ?1 AND step = 'parking' RETURNING parking`,
    )
    .bind(userId, bit)
    .first<{ parking: number }>();
  return row?.parking ?? null;
}

export async function deleteDraft(db: D1Database, userId: number): Promise<void> {
  await db.prepare("DELETE FROM drafts WHERE user_id = ?1").bind(userId).run();
}

// Stops a report that has buttons on screen and returns the message with them. One statement, so
// a report that has just reached the link step is left alone and is not lost in between.
export async function deleteDraftWithButtons(db: D1Database, userId: number): Promise<number | null> {
  const row = await db
    .prepare("DELETE FROM drafts WHERE user_id = ?1 AND step != 'finishing' RETURNING buttons_message_id")
    .bind(userId)
    .first<{ buttons_message_id: number }>();
  return row?.buttons_message_id ?? null;
}

// A cancel during this step may already have made room for a new report, which must stay.
export async function deleteFinishedDraft(db: D1Database, userId: number): Promise<void> {
  await db.prepare("DELETE FROM drafts WHERE user_id = ?1 AND step = 'finishing'").bind(userId).run();
}

export async function saveFinalMessage(
  db: D1Database,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO final_messages (chat_id, message_id, text, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(chatId, messageId, text, Date.now())
    .run();
}

// Removes the row and returns its text. Null means there is none: it has expired, or the
// message was already taken by a press of Done or Cancel.
export async function readFinalMessage(
  db: D1Database,
  chatId: number,
  messageId: number,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT text FROM final_messages WHERE chat_id = ?1 AND message_id = ?2 AND created_at > ?3")
    .bind(chatId, messageId, Date.now() - FINAL_MESSAGE_TTL_MS)
    .first<{ text: string }>();
  return row?.text ?? null;
}

export async function deleteFinalMessage(db: D1Database, chatId: number, messageId: number): Promise<void> {
  await db
    .prepare("DELETE FROM final_messages WHERE chat_id = ?1 AND message_id = ?2")
    .bind(chatId, messageId)
    .run();
}

export async function cachedPlates(db: D1Database, fileUniqueId: string): Promise<string[] | null> {
  const row = await db
    .prepare("SELECT plates FROM plate_cache WHERE file_unique_id = ?1 AND created_at > ?2")
    .bind(fileUniqueId, Date.now() - DRAFT_TTL_MS)
    .first<{ plates: string }>();
  return row ? (JSON.parse(row.plates) as string[]) : null;
}

export async function cachePlates(
  db: D1Database,
  fileUniqueId: string,
  plates: string[],
): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO plate_cache (file_unique_id, plates, created_at) VALUES (?1, ?2, ?3)")
    .bind(fileUniqueId, JSON.stringify(plates), Date.now())
    .run();
}
