-- Additional pause receipt only; preserves all runs, results and existing pause budget.
ALTER TABLE hanq.cbt_runs
 ADD COLUMN checkpoint_version integer NOT NULL DEFAULT 0 CHECK(checkpoint_version >= 0),
 ADD COLUMN pause_submission_key text,
 ADD COLUMN pause_payload_hash text;
ALTER TABLE hanq.cbt_runs ADD CONSTRAINT cbt_pause_receipt CHECK((pause_submission_key IS NULL)=(pause_payload_hash IS NULL));
