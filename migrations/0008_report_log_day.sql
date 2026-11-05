-- Migration number: 0008 	 2026-11-05T00:36:41.886Z
-- The Dublin date of a row of the report log as yyyy-mm-dd.
ALTER TABLE report_log ADD COLUMN day TEXT NOT NULL DEFAULT '';

UPDATE report_log SET day = date(created_at / 1000, 'unixepoch');
