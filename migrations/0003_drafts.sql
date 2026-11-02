-- The report being filled in, one per user, kept for 24 hours until the link is given.
-- prompt is the text of the current bot message, so the screen can be sent again as it was.
-- cleanup is a JSON array of message IDs to delete when the link is given.
-- plates is the JSON array of recognized plates; NULL while recognition is still running.
-- parking is a bit mask over the seven parking options.
CREATE TABLE drafts (
  user_id INTEGER PRIMARY KEY,
  step TEXT NOT NULL,
  prompt TEXT NOT NULL,
  buttons_message_id INTEGER NOT NULL,
  cleanup TEXT NOT NULL DEFAULT '[]',
  failures INTEGER NOT NULL DEFAULT 0,
  address TEXT,
  lat REAL,
  lon REAL,
  first_file_id TEXT,
  first_file_unique_id TEXT,
  first_photo_at INTEGER,
  last_photo_id INTEGER,
  photo_count INTEGER NOT NULL DEFAULT 0,
  plates TEXT,
  plate TEXT,
  time TEXT,
  parking INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Recognition results by the permanent Telegram file ID, kept for 24 hours.
CREATE TABLE plate_cache (
  file_unique_id TEXT PRIMARY KEY,
  plates TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
