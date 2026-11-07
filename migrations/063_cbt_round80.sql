-- Extend only the supported official history exam range; preserve all existing rows.
ALTER TABLE hanq.cbt_runs DROP CONSTRAINT cbt_runs_exam_round_check;
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_runs_exam_round_check CHECK (exam_round BETWEEN 70 AND 80);
ALTER TABLE hanq.cbt_reviews DROP CONSTRAINT cbt_reviews_exam_round_check;
ALTER TABLE hanq.cbt_reviews ADD CONSTRAINT cbt_reviews_exam_round_check CHECK (exam_round BETWEEN 70 AND 80);

