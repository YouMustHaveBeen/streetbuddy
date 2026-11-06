-- Migration number: 0011 	 2026-11-06T21:00:00.000Z

-- kind is now the kind of the address: house, appt, facility, spot or area (an incoming address
-- written by a user has temp until the administrator chooses). The form of an address (point, line
-- or area) is read from its geometry. A row with an old kind (point, line) makes the copy fail.
-- A user's address approved but not yet moved has no kind to move with, so it waits for a decision again.

-- The directory: IDs are never given again, so the counter of the old table is carried over.
CREATE TABLE addresses_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('house', 'appt', 'facility', 'spot', 'area')),
  geometry TEXT NOT NULL,
  west REAL NOT NULL,
  south REAL NOT NULL,
  east REAL NOT NULL,
  north REAL NOT NULL
);
INSERT INTO addresses_new (id, text, kind, geometry, west, south, east, north)
  SELECT id, text, kind, geometry, west, south, east, north FROM addresses;
INSERT INTO addresses_new (id, text, kind, geometry, west, south, east, north)
  SELECT seq, '', 'spot', '', 0, 0, 0, 0 FROM sqlite_sequence
  WHERE name = 'addresses' AND seq > (SELECT coalesce(max(id), 0) FROM addresses_new);
DELETE FROM addresses_new WHERE id > (SELECT coalesce(max(id), 0) FROM addresses);
DROP TABLE addresses;
ALTER TABLE addresses_new RENAME TO addresses;

CREATE TABLE incoming_addresses_new (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('walk', 'user')),
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('house', 'appt', 'facility', 'spot', 'area', 'temp')),
  geometry TEXT NOT NULL,
  user_id INTEGER,
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'replace')),
  walk_file TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO incoming_addresses_new (id, source, text, kind, geometry, user_id, decision, walk_file, created_at)
  SELECT id, source, text, CASE WHEN source = 'user' THEN 'temp' ELSE kind END, geometry, user_id,
    CASE WHEN source = 'user' AND decision IN ('approved', 'replace') THEN NULL ELSE decision END, walk_file, created_at
  FROM incoming_addresses;
DROP TABLE incoming_addresses;
ALTER TABLE incoming_addresses_new RENAME TO incoming_addresses;
