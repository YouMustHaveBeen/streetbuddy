-- Migration number: 0020 	 2026-11-15T12:30:00.000Z

-- Each request to join gets its own row with a row number, so a person can have several rows and the person
-- of a row can be replaced by another ID. A request can also be marked withdrawn.

CREATE TABLE invites_new (
  id INTEGER PRIMARY KEY,
  invited_id INTEGER NOT NULL,
  inviter_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at INTEGER NOT NULL
);

INSERT INTO invites_new (invited_id, inviter_id, status, created_at)
  SELECT invited_id, inviter_id, status, created_at FROM invites ORDER BY created_at, invited_id;

DROP TABLE invites;

ALTER TABLE invites_new RENAME TO invites;
