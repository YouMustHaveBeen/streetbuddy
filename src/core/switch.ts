// The bot's on/off switch: one row in D1. The daily form check turns the bot off,
// the administrators of the closed group turn it on and off from /admin.

// How the last daily form check ended; "unloaded" is a page that could not be loaded.
export type FormCheckOutcome = "ok" | "changed" | "unloaded";

export interface SwitchStatus {
  enabled: boolean;
  lastCheck: { checkedAt: number; result: FormCheckOutcome } | null;
}

export async function isBotEnabled(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT enabled FROM bot_switch WHERE id = 1")
    .first<{ enabled: number }>();
  return row?.enabled !== 0;
}

// Returns true only for the call that actually turned the bot off, so that the owner is
// told once and not on every check while the bot stays off.
export async function disableBot(db: D1Database): Promise<boolean> {
  const result = await db
    .prepare("UPDATE bot_switch SET enabled = 0 WHERE id = 1 AND enabled = 1")
    .run();
  return result.meta.changes > 0;
}

export async function enableBot(db: D1Database): Promise<void> {
  await db.prepare("UPDATE bot_switch SET enabled = 1 WHERE id = 1").run();
}

// The table holds one row that every check overwrites, so it never grows.
export async function recordFormCheck(
  db: D1Database,
  checkedAt: number,
  result: FormCheckOutcome,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO form_check (id, checked_at, result) VALUES (1, ?1, ?2)
       ON CONFLICT (id) DO UPDATE SET checked_at = excluded.checked_at, result = excluded.result`,
    )
    .bind(checkedAt, result)
    .run();
}

// One statement for both the switch and the last check; no check has run yet when the
// form_check row is missing.
export async function getSwitchStatus(db: D1Database): Promise<SwitchStatus> {
  const row = await db
    .prepare(
      `SELECT s.enabled AS enabled, c.checked_at AS checked_at, c.result AS result
       FROM bot_switch s LEFT JOIN form_check c ON c.id = 1
       WHERE s.id = 1`,
    )
    .first<{ enabled: number; checked_at: number | null; result: FormCheckOutcome | null }>();
  return {
    enabled: row?.enabled !== 0,
    lastCheck:
      row?.checked_at != null && row.result != null
        ? { checkedAt: row.checked_at, result: row.result }
        : null,
  };
}
