-- Only future explicit events receive points. Existing users/attempts are never backfilled.
CREATE TABLE hanq.growth_ledger (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 event_key text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('signup','wrong-note-study')),
 amount integer NOT NULL,
 run_id uuid REFERENCES hanq.runs(id),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,event_key),
 CHECK ((kind='signup' AND amount=1000 AND run_id IS NULL) OR (kind='wrong-note-study' AND amount IN (-100,50,100,150,200) AND run_id IS NOT NULL))
);
CREATE UNIQUE INDEX growth_run_once ON hanq.growth_ledger(run_id) WHERE run_id IS NOT NULL;
CREATE FUNCTION hanq.forbid_growth_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'hanq.growth_ledger is append-only'; END; $$;
CREATE TRIGGER growth_ledger_append_only BEFORE UPDATE OR DELETE ON hanq.growth_ledger FOR EACH ROW EXECUTE FUNCTION hanq.forbid_growth_mutation();
CREATE INDEX study_daily_challenges ON hanq.runs(user_id, (selection->>'challengeDate')) WHERE selection->>'mode'='wrong-note-study';
