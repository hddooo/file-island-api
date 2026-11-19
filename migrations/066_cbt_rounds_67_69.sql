-- Extend only the supported official history exam range; preserve all existing rows.
-- 065 is reserved for the independent rehearsal result sync and is not required here.
ALTER TABLE hanq.cbt_runs DROP CONSTRAINT cbt_runs_exam_round_check;
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_runs_exam_round_check CHECK (exam_round BETWEEN 67 AND 80);
ALTER TABLE hanq.cbt_reviews DROP CONSTRAINT cbt_reviews_exam_round_check;
ALTER TABLE hanq.cbt_reviews ADD CONSTRAINT cbt_reviews_exam_round_check CHECK (exam_round BETWEEN 67 AND 80);
