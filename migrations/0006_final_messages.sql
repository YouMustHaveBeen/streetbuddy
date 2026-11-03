-- Migration number: 0006 	 2026-11-03T20:49:13.476Z

-- The report text of a final message (the one with the link), kept until the user presses
-- Done or Cancel on it, and for 48 hours at most, so that Done can rewrite the message.
-- chat_id is the user's private chat. Rows are removed by those buttons and by the cleanup.
CREATE TABLE final_messages (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
