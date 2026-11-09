-- Migration number: 0015 	 2026-11-09T09:45:00.000Z

-- The names of loaded walk files are no longer kept: files come through Import file in /admin.

DROP TABLE walk_files;
ALTER TABLE incoming_addresses DROP COLUMN walk_file;
