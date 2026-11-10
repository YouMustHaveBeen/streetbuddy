-- Migration number: 0017 	 2026-11-10T10:30:00.000Z

-- A facility can have a name (Little Rainbows) next to its address; without one the column is NULL.

ALTER TABLE addresses ADD COLUMN name TEXT;
ALTER TABLE incoming_addresses ADD COLUMN name TEXT;
