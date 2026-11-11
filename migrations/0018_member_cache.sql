-- Migration number: 0018 	 2026-11-10T22:30:00.000Z

-- Members of the group who are not administrators, with the time Telegram last confirmed it.

CREATE TABLE member_cache (
  user_id INTEGER PRIMARY KEY,
  checked_at INTEGER NOT NULL
);
