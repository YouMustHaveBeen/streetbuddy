-- Migration number: 0005 	 2026-11-03T19:19:22.434Z

-- One row: when the daily form check last ran and how it ended, shown on the /admin screen.
-- The row is overwritten by every check, so the table never grows.
CREATE TABLE form_check (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('ok', 'changed', 'unloaded'))
);
