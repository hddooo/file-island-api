-- Official-round CBT final-score growth (one reward per FINAL run, never per question).
-- Depends on 007 (hanq.cbt_runs) AND 008 (growth_ledger.attempt_id + named CHECKs). Apply only after both are approved
-- and applied; operators apply this file on its own (no blanket migrate). No backfill: runs finalized before this
-- migration never receive points.
-- Bands on the original weighted score (0–100, no normalization): <60 -100 · 60–69 +50 · 70–79 +100 · 80–89 +150 · ≥90 +200.

ALTER TABLE hanq.growth_ledger ADD COLUMN cbt_run_id uuid REFERENCES hanq.cbt_runs (id);
CREATE UNIQUE INDEX growth_cbt_run_once ON hanq.growth_ledger (cbt_run_id) WHERE cbt_run_id IS NOT NULL;

ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_kind_valid;
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_kind_valid
  CHECK (kind IN ('signup', 'wrong-note-study', 'practice-quiz', 'practice-mock', 'cbt-exam'));
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK (
     (kind = 'signup'           AND amount = 1000                       AND run_id IS NULL     AND attempt_id IS NULL     AND cbt_run_id IS NULL)
  OR (kind = 'wrong-note-study' AND amount IN (-100, 50, 100, 150, 200) AND run_id IS NOT NULL AND attempt_id IS NULL     AND cbt_run_id IS NULL)
  OR (kind = 'practice-quiz'    AND amount IN (-1, 1)                   AND run_id IS NULL     AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key = 'practice:' || attempt_id::text)
  OR (kind = 'practice-mock'    AND amount IN (-5, 5)                   AND run_id IS NULL     AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key = 'practice:' || attempt_id::text)
  OR (kind = 'cbt-exam'         AND amount IN (-100, 50, 100, 150, 200) AND run_id IS NULL     AND attempt_id IS NULL     AND cbt_run_id IS NOT NULL AND event_key = 'cbt:' || cbt_run_id::text)
);
