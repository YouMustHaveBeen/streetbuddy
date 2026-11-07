-- Migration number: 0014 	 2026-11-07T19:00:00.000Z

-- Every address has a source: walk (the owner's walk), user (written by a user) or osm (the OpenStreetMap
-- extract). The addresses already in the directory get walk; the incoming table takes the value osm too.

ALTER TABLE addresses ADD COLUMN source TEXT NOT NULL DEFAULT 'walk' CHECK (source IN ('walk', 'user', 'osm'));

CREATE TABLE incoming_addresses_new (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('walk', 'user', 'osm')),
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('house', 'appt', 'facility', 'spot', 'area', 'temp')),
  geometry TEXT NOT NULL,
  user_id INTEGER,
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'replace')),
  walk_file TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO incoming_addresses_new (id, source, text, kind, geometry, user_id, decision, walk_file, created_at)
  SELECT id, source, text, kind, geometry, user_id, decision, walk_file, created_at FROM incoming_addresses;
DROP TABLE incoming_addresses;
ALTER TABLE incoming_addresses_new RENAME TO incoming_addresses;
