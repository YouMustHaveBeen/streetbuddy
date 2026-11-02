-- Telegram update_id values already handled. Telegram repeats an update when the webhook
-- answers slowly, and a repeat must not be processed twice.
CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
