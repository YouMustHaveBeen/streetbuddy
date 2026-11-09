-- Migration number: 0016 	 2026-11-09T12:10:00.000Z

-- Anonymous counts of events per day (day is the Dublin date as yyyy-mm-dd), added to while the
-- bot works and kept with no limit. The numbers are not tied to anybody.
CREATE TABLE daily_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, event)
);

-- Unique users of the day, counted every night with the rest of daily_stats.
ALTER TABLE daily_stats ADD COLUMN users INTEGER NOT NULL DEFAULT 0;
