-- Migration number: 0007 	 2026-11-04T20:43:26.954Z

-- The report log: one row for every link given, with no Telegram ID, kept for 2 months.
-- parking is the bit mask over the seven parking options, as in drafts.
CREATE TABLE report_log (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  plate TEXT NOT NULL,
  parking INTEGER NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL
);

-- Statistics per day (day is the Dublin date as yyyy-mm-dd), counted every night from the log.
-- The numbers are not tied to anybody and are kept with no limit.
CREATE TABLE daily_stats (
  day TEXT PRIMARY KEY,
  reports INTEGER NOT NULL,
  option_0 INTEGER NOT NULL,
  option_1 INTEGER NOT NULL,
  option_2 INTEGER NOT NULL,
  option_3 INTEGER NOT NULL,
  option_4 INTEGER NOT NULL,
  option_5 INTEGER NOT NULL,
  option_6 INTEGER NOT NULL
);

-- The top places of the log, replaced every night; rank 1 is the most frequent place and plates
-- is the number of different plates reported there.
CREATE TABLE hotspots (
  rank INTEGER PRIMARY KEY,
  address TEXT NOT NULL,
  plates INTEGER NOT NULL
);

-- The feedback of the users with their Telegram ID, kept for 2 months.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- The line of the report log written for a final message, which Cancel under that message
-- takes out again; null when no line was written.
ALTER TABLE final_messages ADD COLUMN log_id INTEGER;

-- The ID of a draft: handlers of a cancelled or replaced report must not write into the next one.
ALTER TABLE drafts ADD COLUMN draft_id INTEGER NOT NULL DEFAULT 0;
