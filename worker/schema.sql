-- ─── 3d-world leaderboard schema ────────────────────────────────────────
--
-- Two tables. `scores` is one row per player — the board is a personal-best
-- table, not a log of runs, so it grows with the player base rather than with
-- play time. `board_cache` holds exactly one row: the materialised top-N, so a
-- leaderboard view is a single read instead of a hundred.

CREATE TABLE IF NOT EXISTS scores (
  -- Anonymous, client-generated, stable per save. Not a user account.
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  wave       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The board is always read in this order, and rank is `COUNT(*) WHERE score >`.
-- Without the index both become full scans the moment the table is interesting.
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS board_cache (
  id         TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
