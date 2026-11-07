-- Migration number: 0013 	 2026-11-07T21:30:00.000Z

-- The stored phone answer "iphone_bookmark" is renamed to "iphone".
UPDATE user_phones SET phone = 'iphone' WHERE phone = 'iphone_bookmark';
