-- Migration number: 0019 	 2026-11-11T21:00:00.000Z

-- The invite link of each member of the group, the people who asked to join by a link and the
-- messages about such a request that the administrators have been sent.

CREATE TABLE invite_links (
  user_id INTEGER PRIMARY KEY,
  link TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE invites (
  invited_id INTEGER PRIMARY KEY,
  inviter_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL
);

CREATE TABLE invite_notices (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  invited_id INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
