-- Preserve all existing runs and immutable results. Legacy clients retain their protocol.
ALTER TABLE hanq.cbt_runs
 ADD COLUMN answer_mode text NOT NULL DEFAULT 'legacy' CHECK(answer_mode IN ('legacy','batch')),
 ADD COLUMN paused_at timestamptz,
 ADD COLUMN pause_remaining_ms integer,
 ADD COLUMN paused_total_ms bigint NOT NULL DEFAULT 0 CHECK(paused_total_ms >= 0),
 ADD COLUMN batch_submission_key text,
 ADD COLUMN batch_payload_hash text;
DO $$ DECLARE c record; n integer := 0; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='hanq.cbt_runs'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%ends_at%' AND pg_get_constraintdef(oid) LIKE '%started_at%'
 AND pg_get_constraintdef(oid) LIKE '%make_interval%' LOOP
  n := n + 1; EXECUTE format('ALTER TABLE hanq.cbt_runs DROP CONSTRAINT %I',c.conname);
 END LOOP;
 IF n <> 1 THEN RAISE EXCEPTION 'Expected exactly one CBT deadline constraint, found %',n; END IF;
END $$;
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_pause_deadline CHECK(started_at IS NULL OR ends_at = started_at + make_interval(secs => duration_ms / 1000) + paused_total_ms * interval '1 millisecond');
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_pause_state CHECK(
 (paused_at IS NULL AND pause_remaining_ms IS NULL) OR
 (paused_at IS NOT NULL AND pause_remaining_ms IS NOT NULL AND pause_remaining_ms BETWEEN 1 AND duration_ms AND status='active' AND answer_mode='batch'));
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_batch_receipt CHECK((batch_submission_key IS NULL) = (batch_payload_hash IS NULL));
