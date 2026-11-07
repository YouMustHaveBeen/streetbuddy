-- Migration number: 0012 	 2026-11-07T12:00:00.000Z

-- A hotspot keeps the place it was counted for, so that the report map can mark the same place:
-- the directory address, or else the coordinates of the first report of the place.
ALTER TABLE hotspots ADD COLUMN address_id INTEGER;
ALTER TABLE hotspots ADD COLUMN lat REAL;
ALTER TABLE hotspots ADD COLUMN lon REAL;
