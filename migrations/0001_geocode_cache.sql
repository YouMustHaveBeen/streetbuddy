-- Nominatim results; key is "r:<lat>,<lon>" for coordinates or "s:<text>" for a typed address.
CREATE TABLE geocode_cache (
  key TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  created_at INTEGER NOT NULL
);

-- One row: the time (ms) from which the next Nominatim request may start.
CREATE TABLE nominatim_rate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_at INTEGER NOT NULL
);

INSERT INTO nominatim_rate (id, next_at) VALUES (1, 0);
