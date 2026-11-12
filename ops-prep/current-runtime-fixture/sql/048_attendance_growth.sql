-- Daily attendance reward only for newly recorded attendance after this release.
-- Existing attendance and ledger rows are neither rewritten nor backfilled. 047 belongs to a separate pending branch.
ALTER TABLE hanq.growth_ledger ADD COLUMN attendance_day date;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_attendance_day_fk FOREIGN KEY(user_id,attendance_day) REFERENCES hanq.attendance(user_id,day);
CREATE UNIQUE INDEX growth_attendance_once ON hanq.growth_ledger(user_id,attendance_day) WHERE attendance_day IS NOT NULL;
DO $$ DECLARE old_kind text; old_amount text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO old_kind FROM pg_constraint WHERE conrelid='hanq.growth_ledger'::regclass AND conname='growth_ledger_kind_valid';
 SELECT pg_get_expr(conbin,conrelid) INTO old_amount FROM pg_constraint WHERE conrelid='hanq.growth_ledger'::regclass AND conname='growth_ledger_amount_valid';
 IF old_kind IS NULL OR old_amount IS NULL THEN RAISE EXCEPTION 'growth validation not found'; END IF;
 ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_kind_valid;
 EXECUTE 'ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_kind_valid CHECK (('||old_kind||') OR kind=''attendance'')';
 ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
 EXECUTE 'ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK ((('||old_amount||') AND attendance_day IS NULL) OR (kind=''attendance'' AND amount=10 AND attendance_day IS NOT NULL AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL AND battle_match_id IS NULL AND admin_adjustment_id IS NULL AND event_key=''attendance:''||attendance_day::text))';
END $$;
