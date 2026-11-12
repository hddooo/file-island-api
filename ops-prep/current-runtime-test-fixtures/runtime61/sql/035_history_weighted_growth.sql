-- Future grades only; keep all legacy ledger rows and policies intact. No backfill.
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK(
 (kind='signup' AND amount=1000 AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL)
 OR(kind='wrong-note-study' AND (amount BETWEEN -150 AND 150 OR amount=200) AND run_id IS NOT NULL AND attempt_id IS NULL AND cbt_run_id IS NULL)
 OR(kind='practice-quiz' AND amount IN(-1,0,1) AND run_id IS NULL AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key='practice:'||attempt_id::text)
 OR(kind='practice-mock' AND amount BETWEEN -5 AND 5 AND run_id IS NULL AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key='practice:'||attempt_id::text)
 OR(kind='cbt-exam' AND (amount BETWEEN -100 AND 100 OR amount IN(150,200)) AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NOT NULL AND event_key='cbt:'||cbt_run_id::text)
 OR(kind='toeic-answer' AND amount IN(-1,0,1) AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL AND event_key ~ '^toeic-(focus|practice):[0-9a-f-]{36}$'));

