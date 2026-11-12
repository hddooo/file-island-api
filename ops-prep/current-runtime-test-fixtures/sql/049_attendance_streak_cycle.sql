-- Five-day repeating attendance schedule; preserve every earlier award, including flat10 entries from048.
-- Existing validation for all other XP kinds is retained exactly. No backfill or data update.
DO $$ DECLARE old_amount text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO old_amount FROM pg_constraint WHERE conrelid='hanq.growth_ledger'::regclass AND conname='growth_ledger_amount_valid';
 IF old_amount IS NULL THEN RAISE EXCEPTION 'growth validation not found'; END IF;
 ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
 EXECUTE 'ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK ((('||old_amount||') AND kind<>''attendance'') OR (kind=''attendance'' AND amount IN(10,20,30,40,50) AND attendance_day IS NOT NULL AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL AND battle_match_id IS NULL AND admin_adjustment_id IS NULL AND event_key=''attendance:''||attendance_day::text))';
END $$;
