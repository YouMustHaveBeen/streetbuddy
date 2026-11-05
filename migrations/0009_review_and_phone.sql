-- Migration number: 0009 	 2026-11-05T15:20:00.000Z

-- The "Were you a" answer stays in the draft until the link is given, and editing marks a
-- draft that came to a step from the Edit screen.
ALTER TABLE drafts ADD COLUMN road_user TEXT;
ALTER TABLE drafts ADD COLUMN editing INTEGER NOT NULL DEFAULT 0;

-- The phone chosen by a user and the number of links given since that choice. Rows are
-- removed by the cleanup two months after last_used_at.
CREATE TABLE user_phones (
  user_id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  reports INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
