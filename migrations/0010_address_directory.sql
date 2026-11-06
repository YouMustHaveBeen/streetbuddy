-- Migration number: 0010 	 2026-11-06T16:00:00.000Z

-- The address directory the bot takes addresses from, kept until an administrator deletes a row.
-- kind is point, line or area; geometry is the GeoJSON geometry (Point, LineString,
-- MultiLineString or Polygon) as JSON; west, south, east, north is the rectangle around it.
CREATE TABLE addresses (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('point', 'line', 'area')),
  geometry TEXT NOT NULL,
  west REAL NOT NULL,
  south REAL NOT NULL,
  east REAL NOT NULL,
  north REAL NOT NULL
);

-- Incoming addresses waiting for the administrator: from the walk file (source walk, no user_id)
-- and written by users (source user, with the author's Telegram ID until the decision).
-- decision is NULL while there is none, then approved, rejected or replace; the nightly move takes
-- the decided rows out. duplicate_m is the distance in metres to the directory address with the
-- same text when the row is a possible duplicate, otherwise NULL.
CREATE TABLE incoming_addresses (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('walk', 'user')),
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('point', 'line', 'area')),
  geometry TEXT NOT NULL,
  user_id INTEGER,
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'replace')),
  duplicate_m INTEGER,
  created_at INTEGER NOT NULL
);

-- The address screen of a report: its choices as JSON, the chosen directory address and whether
-- the address was written by the user.
ALTER TABLE drafts ADD COLUMN address_options TEXT;
ALTER TABLE drafts ADD COLUMN address_id INTEGER;
ALTER TABLE drafts ADD COLUMN address_typed INTEGER NOT NULL DEFAULT 0;

-- The directory address chosen for the report, NULL for an address from Nominatim or written by the user.
ALTER TABLE report_log ADD COLUMN address_id INTEGER;
