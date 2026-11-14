-- REVIEW PROPOSAL ONLY. Outside migrations; never loaded by runtime or migration tooling.
-- Run as the table-owning application role (app), not postgres: there are no default privileges in schema hanq.
-- Requires the existing base through 060 and approval for this additive feature schema.
-- No legacy rewrite, backfill, retention deletion, credential grant, or production execution.
-- Latest-five means a SELECT projection. Keep older minimal receipts to reject changed retries forever.
-- Rollback: disable the new feature routes; retain receipts/ledger/constraints. Never DELETE awarded history.
BEGIN;
CREATE TABLE hanq.source_full_attempts (
 user_id uuid NOT NULL REFERENCES hanq.users(id), id uuid NOT NULL,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 quiz_id text NOT NULL CHECK(length(quiz_id) BETWEEN 1 AND 256),
 source_version text NOT NULL CHECK(source_version ~ '^[0-9a-f]{64}$'),
 source_revision text NOT NULL CHECK(length(source_revision) BETWEEN 1 AND 128),
 grading_version integer NOT NULL CHECK(grading_version IN(1,2)),
 payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 correct integer NOT NULL, total integer NOT NULL CHECK(total BETWEEN 1 AND 200),
 -- Tier the score would earn. Recorded on every attempt, including ones that receive no XP.
 score_xp integer GENERATED ALWAYS AS (
   CASE WHEN correct::bigint*100>=total::bigint*80 THEN 10
        WHEN correct::bigint*100>=total::bigint*70 THEN 5
        WHEN correct::bigint*100>=total::bigint*60 THEN 1 ELSE 0 END
 ) STORED,
 -- Daily limit: per owner and quiz, only the first XP-earning completion of a KST day is rewarded.
 rewarded boolean NOT NULL,
 xp_award integer GENERATED ALWAYS AS (
   CASE WHEN NOT rewarded THEN 0
        WHEN correct::bigint*100>=total::bigint*80 THEN 10
        WHEN correct::bigint*100>=total::bigint*70 THEN 5
        WHEN correct::bigint*100>=total::bigint*60 THEN 1 ELSE 0 END
 ) STORED,
 completed_at timestamptz NOT NULL,
 award_day date NOT NULL,
 PRIMARY KEY(user_id,id), UNIQUE(user_id,id,xp_award), CHECK(correct BETWEEN 0 AND total),
 CHECK(award_day=(completed_at AT TIME ZONE 'Asia/Seoul')::date),
 CHECK(NOT rewarded OR correct::bigint*100>=total::bigint*60)
);
CREATE INDEX source_full_attempts_recent ON hanq.source_full_attempts(user_id,quiz_id,source_version,grading_version,source_revision,seq DESC);
-- At most one rewarded completion per owner, quiz and KST day, across source and grading versions.
CREATE UNIQUE INDEX source_full_attempts_daily_award ON hanq.source_full_attempts(user_id,quiz_id,source_revision,award_day) WHERE rewarded;
CREATE TRIGGER source_full_attempts_append_only BEFORE UPDATE OR DELETE ON hanq.source_full_attempts
 FOR EACH ROW EXECUTE FUNCTION hanq.forbid_growth_mutation();

ALTER TABLE hanq.growth_ledger ADD COLUMN source_attempt_id uuid;
-- Composite FK binds owner, attempt and exact server-derived award, including zero.
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_source_full_receipt
 FOREIGN KEY(user_id,source_attempt_id,amount) REFERENCES hanq.source_full_attempts(user_id,id,xp_award);
CREATE UNIQUE INDEX growth_source_full_once ON hanq.growth_ledger(user_id,source_attempt_id) WHERE source_attempt_id IS NOT NULL;
DO $$ DECLARE old_kind text; old_amount text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO old_kind FROM pg_constraint WHERE conrelid='hanq.growth_ledger'::regclass AND conname='growth_ledger_kind_valid';
 SELECT pg_get_expr(conbin,conrelid) INTO old_amount FROM pg_constraint WHERE conrelid='hanq.growth_ledger'::regclass AND conname='growth_ledger_amount_valid';
 IF old_kind IS NULL OR old_amount IS NULL THEN RAISE EXCEPTION 'growth validation not found'; END IF;
 ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_kind_valid;
 ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
 EXECUTE 'ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_kind_valid CHECK (('||old_kind||') OR kind=''source-full-quiz'')';
 EXECUTE 'ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK ((('||old_amount||') AND source_attempt_id IS NULL) OR (kind=''source-full-quiz'' AND amount IN(0,1,5,10) AND source_attempt_id IS NOT NULL AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL AND battle_match_id IS NULL AND admin_adjustment_id IS NULL AND attendance_day IS NULL AND event_key=''source-full:''||source_attempt_id::text))';
END $$;
COMMIT;
