-- Ordinary era practice growth (quiz ±1, past-exam mock ±5) for POST /api/v1/attempts (source 'practice') only.
-- Depends on 003 (growth_ledger) and 001 (attempts). Uses NO object from 007 (hanq.cbt_runs / attempts.cbt_run_id), so it
-- can be approved and applied on its own while 007 is still unapproved: apply THIS FILE ONLY, never a blanket migrate.
-- Additive: one nullable column, one partial unique index, and the kind/amount CHECK widened to a strict superset
-- (every existing signup / wrong-note-study row stays valid). No backfill: existing attempts never receive points.
-- The append-only trigger from 003 stays in force (ADD COLUMN does not fire row triggers; nothing is updated).

ALTER TABLE hanq.growth_ledger ADD COLUMN attempt_id uuid REFERENCES hanq.attempts (id);

-- One reward per recorded attempt (the PRIMARY KEY (user_id, event_key) with event_key 'practice:<attempt id>' already
-- guarantees this per user; the index also forbids pointing two rows at one attempt under different keys).
CREATE UNIQUE INDEX growth_attempt_once ON hanq.growth_ledger (attempt_id) WHERE attempt_id IS NOT NULL;

-- Replace 003's two anonymous CHECKs (column CHECK on kind + table CHECK on kind/amount/run_id) by named, wider ones.
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_kind_check;
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_check;

ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_kind_valid
  CHECK (kind IN ('signup', 'wrong-note-study', 'practice-quiz', 'practice-mock'));
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK (
     (kind = 'signup'           AND amount = 1000                       AND run_id IS NULL     AND attempt_id IS NULL)
  OR (kind = 'wrong-note-study' AND amount IN (-100, 50, 100, 150, 200) AND run_id IS NOT NULL AND attempt_id IS NULL)
  OR (kind = 'practice-quiz'    AND amount IN (-1, 1)                   AND run_id IS NULL     AND attempt_id IS NOT NULL AND event_key = 'practice:' || attempt_id::text)
  OR (kind = 'practice-mock'    AND amount IN (-5, 5)                   AND run_id IS NULL     AND attempt_id IS NOT NULL AND event_key = 'practice:' || attempt_id::text)
);
