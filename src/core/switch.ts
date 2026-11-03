// The bot's on/off switch: one row in D1. The daily form check turns the bot off,
// the owner turns it on again.

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
