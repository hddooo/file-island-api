-- Append-only administrator adjustments. No existing XP, account, role or security policy is rewritten.
CREATE TABLE hanq.admin_xp_adjustments (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES hanq.users(id),
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 request_id uuid NOT NULL,
 requested_delta integer NOT NULL CHECK(requested_delta BETWEEN -1000000 AND 1000000 AND requested_delta<>0),
 balance_before bigint NOT NULL CHECK(balance_before>=0),
 applied_delta integer NOT NULL CHECK(applied_delta BETWEEN -1000000 AND 1000000),
 balance_after bigint NOT NULL CHECK(balance_after>=0 AND balance_after=balance_before+applied_delta),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 300),
 created_at timestamptz NOT NULL,
 UNIQUE(actor_id,request_id),
 CHECK(applied_delta=greatest(requested_delta,-balance_before))
);
CREATE INDEX admin_xp_owner_time ON hanq.admin_xp_adjustments(user_id,created_at DESC,id DESC);
CREATE TRIGGER admin_xp_append_only BEFORE UPDATE OR DELETE ON hanq.admin_xp_adjustments FOR EACH ROW EXECUTE FUNCTION hanq.forbid_growth_mutation();
ALTER TABLE hanq.growth_ledger ADD COLUMN admin_adjustment_id uuid REFERENCES hanq.admin_xp_adjustments(id);
CREATE UNIQUE INDEX growth_admin_xp_once ON hanq.growth_ledger(admin_adjustment_id) WHERE admin_adjustment_id IS NOT NULL;
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_kind_valid;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_kind_valid CHECK(kind IN('signup','wrong-note-study','practice-quiz','practice-mock','cbt-exam','toeic-answer','battle','admin-adjustment'));
-- Retain the exact existing learning/battle validation; only append the new source branch.
DO $$ DECLARE old_check text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO old_check FROM pg_constraint WHERE conrelid='hanq.growth_ledger'::regclass AND conname='growth_ledger_amount_valid';
 IF old_check IS NULL THEN RAISE EXCEPTION 'growth validation not found'; END IF;
 ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
 EXECUTE 'ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK ((('||old_check||') AND admin_adjustment_id IS NULL) OR (kind=''admin-adjustment'' AND amount BETWEEN -1000000 AND 1000000 AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL AND battle_match_id IS NULL AND admin_adjustment_id IS NOT NULL AND event_key=''admin:''||admin_adjustment_id::text))';
END $$;
