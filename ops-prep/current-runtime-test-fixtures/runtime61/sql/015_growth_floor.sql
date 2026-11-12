-- No account editing or history rewrite. Refuse deployment if preexisting negative sums need an explicitly approved repair.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM(SELECT user_id,sum(amount) balance FROM hanq.growth_ledger GROUP BY user_id)s WHERE balance<0) THEN
  RAISE EXCEPTION 'Negative growth balances require approved reconciliation before this migration';
 END IF;
END $$;
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK(
 (kind='signup' AND amount=1000 AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL)
 OR(kind='wrong-note-study' AND (amount BETWEEN -100 AND 0 OR amount IN(50,100,150,200)) AND run_id IS NOT NULL AND attempt_id IS NULL AND cbt_run_id IS NULL)
 OR(kind='practice-quiz' AND amount IN(-1,0,1) AND run_id IS NULL AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key='practice:'||attempt_id::text)
 OR(kind='practice-mock' AND (amount BETWEEN -5 AND 0 OR amount=5) AND run_id IS NULL AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key='practice:'||attempt_id::text)
 OR(kind='cbt-exam' AND (amount BETWEEN -100 AND 0 OR amount IN(50,100,150,200)) AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NOT NULL AND event_key='cbt:'||cbt_run_id::text));
CREATE FUNCTION hanq.enforce_growth_floor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance bigint;
BEGIN
 -- Owner row first; volatile SQL reads after waiting see committed prior ledger inserts.
 PERFORM 1 FROM hanq.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO balance FROM hanq.growth_ledger WHERE user_id=NEW.user_id;
 IF balance<0 THEN RAISE EXCEPTION 'Growth balance requires approved reconciliation'; END IF;
 IF NEW.amount<0 AND balance+NEW.amount<0 THEN NEW.amount:=(-balance)::integer; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER growth_floor BEFORE INSERT ON hanq.growth_ledger FOR EACH ROW EXECUTE FUNCTION hanq.enforce_growth_floor();
