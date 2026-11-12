-- Schema only. No historical runs, answers, attempts or growth are changed.
ALTER TABLE hanq.cbt_runs ADD COLUMN attempt_policy text NOT NULL DEFAULT 'legacy',
 ADD COLUMN attempt_token_hash text, ADD COLUMN incomplete_at timestamptz,
 ADD COLUMN incomplete_reason text, ADD COLUMN checkpoint_payload_hash text;
ALTER TABLE hanq.cbt_runs DROP CONSTRAINT cbt_runs_status_check;
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_runs_status_check CHECK(status IN ('ready','active','final','incomplete'));
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='hanq.cbt_runs'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%ready%' AND pg_get_constraintdef(oid) LIKE '%started_at%' LOOP
 EXECUTE format('ALTER TABLE hanq.cbt_runs DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_run_start_state CHECK(status='incomplete' OR ((status='ready')=(started_at IS NULL)));
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_incomplete_state CHECK((status='incomplete')=(incomplete_at IS NOT NULL AND incomplete_reason IS NOT NULL));
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_uninterrupted_deadline CHECK(attempt_policy<>'uninterrupted-v1' OR (paused_at IS NULL AND paused_total_ms=0));
ALTER TABLE hanq.cbt_runs ALTER COLUMN attempt_policy SET DEFAULT 'uninterrupted-v1';
