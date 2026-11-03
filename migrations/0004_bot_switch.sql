-- One row: whether the bot starts new reports. The daily form check turns it off when the
-- Traffic Watch form has changed; the owner turns it on again.
CREATE TABLE bot_switch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);

INSERT INTO bot_switch (id, enabled) VALUES (1, 1);
