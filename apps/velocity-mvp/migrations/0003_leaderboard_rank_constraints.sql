PRAGMA foreign_keys = ON;

WITH ranked AS (
  SELECT
    lr.user_id,
    ROW_NUMBER() OVER (
      ORDER BY
        lr.total_equivalent_engineering_hours DESC,
        lr.total_merged_prs_ci_verified DESC,
        lr.total_merged_prs DESC,
        lower(u.handle) ASC
    ) AS computed_rank
  FROM leaderboard_rows lr
  INNER JOIN users u ON u.id = lr.user_id
)
UPDATE leaderboard_rows
SET rank = (
      SELECT computed_rank
      FROM ranked
      WHERE ranked.user_id = leaderboard_rows.user_id
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE user_id IN (SELECT user_id FROM ranked);

CREATE TRIGGER IF NOT EXISTS trg_leaderboard_rows_rank_insert
BEFORE INSERT ON leaderboard_rows
FOR EACH ROW
WHEN NEW.rank <= 0
BEGIN
  SELECT RAISE(ABORT, 'leaderboard_rows.rank must be > 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_leaderboard_rows_rank_update
BEFORE UPDATE OF rank ON leaderboard_rows
FOR EACH ROW
WHEN NEW.rank <= 0
BEGIN
  SELECT RAISE(ABORT, 'leaderboard_rows.rank must be > 0');
END;
