// The report draft in D1. Everything that can change concurrently is written by single atomic statements.
import { DAY_MS } from "../core";

// Lifetime of drafts and of the recognition cache.
const DRAFT_TTL_MS = DAY_MS;

// Lifetime of the stored text of a final message, which Done needs to rewrite the message.
export const FINAL_MESSAGE_TTL_MS = 2 * DAY_MS;

export interface Draft {
  user_id: number;
  draft_id: number;
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
  road_user: string | null;
  editing: number;
  address_options: string | null;
  address_id: number | null;
  address_typed: number;
  created_at: number;
}

// A choice of the address screen; id is the directory address, null for Nominatim.
export interface AddressOption {
  text: string;
  id: number | null;
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
  | "road_user"
  | "review"
  | "edit"
  | "phone" // The phone is asked for before the first link.
  | "finishing"
  | "feedback_input" // Not a report: waiting for the text of a feedback.
  | "phone_choice" // Not a report: /phone.
  | "admin_location" // Not a report: /admin waits for the location of a directory address.
  | "admin_text" // Not a report: /admin waits for the new text of a directory address.
  | "admin_move"; // Not a report: /admin waits for the new location of a directory point.

export const isAdminStep = (step: Step): boolean => step.startsWith("admin_");

export type DraftChanges = Partial<
  Pick<
    Draft,
    "step"
    | "failures"
    | "address"
    | "lat"
    | "lon"
    | "plate"
    | "time"
    | "first_photo_at"
    | "road_user"
    | "editing"
    | "address_options"
    | "address_id"
    | "address_typed"
  >
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

// Creates a draft with a random ID of its own and returns that ID.
export async function createDraft(
  db: D1Database,
  userId: number,
  messageId: number,
  prompt: string,
  changes: DraftChanges,
  cleanupIds: number[],
): Promise<number> {
  const draftId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
  await db
    .prepare(
      `INSERT OR REPLACE INTO drafts
       (user_id, draft_id, step, prompt, buttons_message_id, cleanup, failures, address, lat, lon, created_at,
        address_options, address_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      userId,
      draftId,
      changes.step,
      prompt,
      messageId,
      JSON.stringify(cleanupIds),
      changes.failures ?? 0,
      changes.address ?? null,
      changes.lat ?? null,
      changes.lon ?? null,
      Date.now(),
      changes.address_options ?? null,
      changes.address_id ?? null,
    )
    .run();
  return draftId;
}

// Puts the just sent message in place of the previous one, only if the draft is still on
// the expected step. Returns the previous message ID, or null when the step has moved on
// and the just sent message is the one that is out of place.
export async function swapScreen(
  db: D1Database,
  userId: number,
  draftId: number,
  expectedStep: Step,
  messageId: number,
  prompt: string,
  changes: DraftChanges,
  cleanupIds: number[],
): Promise<number | null> {
  const columns = Object.keys(changes) as (keyof DraftChanges)[];
  const sets = columns.map((column, i) => `${column} = ?${i + 7}`);
  const update = db
    .prepare(
      `UPDATE drafts SET buttons_message_id = ?4, prompt = ?5, ${appendCleanup("?6")}
       ${sets.map((set) => `, ${set}`).join("")}
       WHERE user_id = ?1 AND draft_id = ?2 AND step = ?3`,
    )
    .bind(
      userId,
      draftId,
      expectedStep,
      messageId,
      prompt,
      JSON.stringify(cleanupIds),
      ...columns.map((column) => changes[column] ?? null),
    );
  const select = db
    .prepare("SELECT buttons_message_id FROM drafts WHERE user_id = ?1 AND draft_id = ?2 AND step = ?3")
    .bind(userId, draftId, expectedStep);
  // One transaction: reads the previous message and writes the new one.
  const [previous, updated] = await db.batch<{ buttons_message_id: number }>([select, update]);
  return updated.meta.changes > 0 ? (previous.results[0]?.buttons_message_id ?? null) : null;
}

export async function addCleanup(
  db: D1Database,
  userId: number,
  draftId: number,
  ids: number[],
): Promise<void> {
  await db
    .prepare(`UPDATE drafts SET ${appendCleanup("?3")} WHERE user_id = ?1 AND draft_id = ?2`)
    .bind(userId, draftId, JSON.stringify(ids))
    .run();
}

export async function recordPhoto(
  db: D1Database,
  userId: number,
  draftId: number,
  photo: { fileId: string; fileUniqueId: string; sentAt: number; messageId: number },
): Promise<{ photoCount: number; isFirst: boolean } | null> {
  // The first photo is the one with the lowest message ID; when it changes, the plates are cleared.
  const earlier = "first_message_id IS NULL OR ?6 < first_message_id";
  const row = await db
    .prepare(
      `UPDATE drafts SET
         first_file_id = CASE WHEN ${earlier} THEN ?3 ELSE first_file_id END,
         first_file_unique_id = CASE WHEN ${earlier} THEN ?4 ELSE first_file_unique_id END,
         first_photo_at = CASE WHEN ${earlier} THEN ?5 ELSE first_photo_at END,
         plates = CASE WHEN ${earlier} THEN NULL ELSE plates END,
         first_message_id = CASE WHEN ${earlier} THEN ?6 ELSE first_message_id END,
         last_photo_id = MAX(COALESCE(last_photo_id, 0), ?6),
         photo_count = photo_count + 1
       WHERE user_id = ?1 AND draft_id = ?2 AND step = 'photos'
       RETURNING photo_count, first_message_id`,
    )
    .bind(userId, draftId, photo.fileId, photo.fileUniqueId, photo.sentAt, photo.messageId)
    .first<{ photo_count: number; first_message_id: number }>();
  if (!row) return null;
  return { photoCount: row.photo_count, isFirst: row.first_message_id === photo.messageId };
}

// Stores the result only if this photo is still the first one of this draft.
export async function setPlates(
  db: D1Database,
  userId: number,
  draftId: number,
  fileUniqueId: string,
  plates: string[],
): Promise<void> {
  await db
    .prepare("UPDATE drafts SET plates = ?4 WHERE user_id = ?1 AND draft_id = ?2 AND first_file_unique_id = ?3")
    .bind(userId, draftId, fileUniqueId, JSON.stringify(plates))
    .run();
}

// Moves the draft to another step; false means someone else got there first.
export async function moveStep(
  db: D1Database,
  userId: number,
  draftId: number,
  from: Step,
  to: Step,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE drafts SET step = ?4 WHERE user_id = ?1 AND draft_id = ?2 AND step = ?3")
    .bind(userId, draftId, from, to)
    .run();
  return result.meta.changes > 0;
}

// Takes the report for giving the link and returns the parking options as they are now.
// Null means someone else got there first.
export async function startFinishing(
  db: D1Database,
  userId: number,
  draftId: number,
  from: Step,
): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE drafts SET step = 'finishing'
       WHERE user_id = ?1 AND draft_id = ?2 AND step = ?3 RETURNING parking`,
    )
    .bind(userId, draftId, from)
    .first<{ parking: number }>();
  return row?.parking ?? null;
}

// Flips one bit in a single statement.
export async function toggleParking(
  db: D1Database,
  userId: number,
  draftId: number,
  bit: number,
): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE drafts SET parking = (parking | ?3) - (parking & ?3)
       WHERE user_id = ?1 AND draft_id = ?2 AND step = 'parking' RETURNING parking`,
    )
    .bind(userId, draftId, bit)
    .first<{ parking: number }>();
  return row?.parking ?? null;
}

export async function deleteDraft(db: D1Database, userId: number, draftId: number): Promise<void> {
  await db.prepare("DELETE FROM drafts WHERE user_id = ?1 AND draft_id = ?2").bind(userId, draftId).run();
}

// Stops a report that has buttons on screen and returns the message with them; a report on
// the step that gives the link stays.
export async function deleteDraftWithButtons(db: D1Database, userId: number): Promise<number | null> {
  const row = await db
    .prepare("DELETE FROM drafts WHERE user_id = ?1 AND step != 'finishing' RETURNING buttons_message_id")
    .bind(userId)
    .first<{ buttons_message_id: number }>();
  return row?.buttons_message_id ?? null;
}

// Removes a question of /admin left without an answer.
export async function deleteAdminDraft(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare("DELETE FROM drafts WHERE user_id = ?1 AND step IN ('admin_location', 'admin_text', 'admin_move')")
    .bind(userId)
    .run();
}

// Removes the draft only if it is still on the step that gives the link, and returns its list
// of messages to delete as it is now; null when the draft is already gone.
export async function deleteFinishedDraft(db: D1Database, userId: number, draftId: number): Promise<number[] | null> {
  const row = await db
    .prepare("DELETE FROM drafts WHERE user_id = ?1 AND draft_id = ?2 AND step = 'finishing' RETURNING cleanup")
    .bind(userId, draftId)
    .first<{ cleanup: string }>();
  return row ? (JSON.parse(row.cleanup) as number[]) : null;
}

// logId is the line of the report log written for this report, or null when there is none;
// Cancel under the final message takes that line out again.
export async function saveFinalMessage(
  db: D1Database,
  chatId: number,
  messageId: number,
  text: string,
  logId: number | null,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO final_messages (chat_id, message_id, text, created_at, log_id) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(chatId, messageId, text, Date.now(), logId)
    .run();
}

// Returns the text of a final message without removing it; deleteFinalMessage removes it once
// Done has really changed the message. Null means there is none: it has expired, or the
// message was already finished by Done or Cancel.
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

const deleteFinalStatement = (db: D1Database, chatId: number, messageId: number) =>
  db.prepare("DELETE FROM final_messages WHERE chat_id = ?1 AND message_id = ?2").bind(chatId, messageId);

// Cancel under the final message: removes the line of the report log and then the stored text.
export async function cancelFinalMessage(db: D1Database, chatId: number, messageId: number): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM report_log WHERE id =
           (SELECT log_id FROM final_messages WHERE chat_id = ?1 AND message_id = ?2)`,
      )
      .bind(chatId, messageId),
    deleteFinalStatement(db, chatId, messageId),
  ]);
}

export async function deleteFinalMessage(db: D1Database, chatId: number, messageId: number): Promise<void> {
  await deleteFinalStatement(db, chatId, messageId).run();
}

export interface OpenFinalMessage {
  chat_id: number;
  message_id: number;
  text: string;
}

// The stored texts written at or before the cutoff, oldest first.
export async function listExpiredFinalMessages(
  db: D1Database,
  cutoff: number,
  limit: number,
): Promise<OpenFinalMessage[]> {
  const rows = await db
    .prepare(
      "SELECT chat_id, message_id, text FROM final_messages WHERE created_at <= ?1 ORDER BY created_at LIMIT ?2",
    )
    .bind(cutoff, limit)
    .all<OpenFinalMessage>();
  return rows.results;
}

// Removes the stored texts of the messages whose buttons are gone, in one batch.
export async function deleteFinalMessages(db: D1Database, messages: OpenFinalMessage[]): Promise<void> {
  if (messages.length === 0) return;
  await db.batch(messages.map((message) => deleteFinalStatement(db, message.chat_id, message.message_id)));
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
