-- Partial indexes keep each run reading only the rows it acts on (D1 bills rows read).

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  subscribed INTEGER NOT NULL DEFAULT 0,
  lease INTEGER NOT NULL DEFAULT 0, -- push notifications confirmed until, epoch ms
  about TEXT                        -- the channel line the model sees; null until fetched
);
CREATE INDEX IF NOT EXISTS channels_lease ON channels (lease) WHERE subscribed;

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  channel TEXT,
  published INTEGER,               -- epoch ms
  category INTEGER,                -- YouTube category; 10 is music
  meta TEXT,                       -- what the model sees: { video, channel, minutes }; null until enriched, '{}' if gone
  answers TEXT NOT NULL DEFAULT '{}', -- question id → P(yes)
  asked TEXT NOT NULL DEFAULT '{}',   -- question id → signature of the text it was asked with
  sig TEXT,                        -- signature of the whole question set when last asked
  ask INTEGER                      -- to ask: 2 = requested by the page, 1 = new upload; null = nothing to ask
);
CREATE INDEX IF NOT EXISTS videos_ask ON videos (ask DESC, published DESC) WHERE ask;
