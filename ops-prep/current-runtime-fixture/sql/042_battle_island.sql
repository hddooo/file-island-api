-- Opt-in battle presence and isolated game state; existing learning records are untouched.
CREATE TABLE hanq.battle_presence (
 user_id uuid PRIMARY KEY REFERENCES hanq.users(id), public_id uuid NOT NULL UNIQUE,
 family text NOT NULL CHECK(family IN('agumon','patamon')), last_seen timestamptz NOT NULL
);
CREATE TABLE hanq.battle_matches (
 id uuid PRIMARY KEY, challenger uuid NOT NULL REFERENCES hanq.users(id), opponent uuid NOT NULL REFERENCES hanq.users(id),
 subject text NOT NULL CHECK(subject IN('history','toeic')), status text NOT NULL CHECK(status IN('pending','ready','playing','between','finished','void','declined','expired')),
 state jsonb NOT NULL, question_bank jsonb NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 CHECK(challenger<>opponent)
);
CREATE TABLE hanq.battle_seats (
 user_id uuid PRIMARY KEY REFERENCES hanq.users(id), match_id uuid NOT NULL REFERENCES hanq.battle_matches(id)
);
CREATE INDEX battle_match_participants ON hanq.battle_matches(challenger,opponent);
CREATE INDEX battle_presence_seen ON hanq.battle_presence(last_seen);

-- Battle awards append to the existing total without changing historical learning entries.
CREATE TABLE hanq.battle_xp_ledger (
 match_id uuid NOT NULL REFERENCES hanq.battle_matches(id), user_id uuid NOT NULL REFERENCES hanq.users(id),
 outcome text NOT NULL CHECK(outcome IN('win','loss','void')), reason text NOT NULL,
 self_stage integer NOT NULL CHECK(self_stage BETWEEN 1 AND 6), opponent_stage integer NOT NULL CHECK(opponent_stage BETWEEN 1 AND 6),
 requested_delta integer NOT NULL CHECK(requested_delta BETWEEN -200 AND 200), applied_delta integer NOT NULL CHECK(applied_delta BETWEEN -200 AND 200),
 balance_after bigint NOT NULL CHECK(balance_after>=0), created_at timestamptz NOT NULL,
 PRIMARY KEY(match_id,user_id)
);
ALTER TABLE hanq.growth_ledger ADD COLUMN battle_match_id uuid REFERENCES hanq.battle_matches(id);
CREATE UNIQUE INDEX growth_battle_once ON hanq.growth_ledger(user_id,battle_match_id) WHERE battle_match_id IS NOT NULL;
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_kind_valid;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_kind_valid CHECK(kind IN('signup','wrong-note-study','practice-quiz','practice-mock','cbt-exam','toeic-answer','battle'));
ALTER TABLE hanq.growth_ledger DROP CONSTRAINT growth_ledger_amount_valid;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_ledger_amount_valid CHECK(
 (kind='signup' AND amount=1000 AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL)
 OR(kind='wrong-note-study' AND (amount BETWEEN -150 AND 150 OR amount=200) AND run_id IS NOT NULL AND attempt_id IS NULL AND cbt_run_id IS NULL)
 OR(kind='practice-quiz' AND amount IN(-1,0,1) AND run_id IS NULL AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key='practice:'||attempt_id::text)
 OR(kind='practice-mock' AND amount BETWEEN -5 AND 5 AND run_id IS NULL AND attempt_id IS NOT NULL AND cbt_run_id IS NULL AND event_key='practice:'||attempt_id::text)
 OR(kind='cbt-exam' AND (amount BETWEEN -100 AND 100 OR amount IN(150,200)) AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NOT NULL AND event_key='cbt:'||cbt_run_id::text)
 OR(kind='toeic-answer' AND amount IN(-1,0,1) AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL AND event_key ~ '^toeic-(focus|practice):[0-9a-f-]{36}$')
 OR(kind='battle' AND amount BETWEEN -200 AND 200 AND run_id IS NULL AND attempt_id IS NULL AND cbt_run_id IS NULL AND battle_match_id IS NOT NULL AND event_key='battle:'||battle_match_id::text));


CREATE TRIGGER battle_xp_append_only BEFORE UPDATE OR DELETE ON hanq.battle_xp_ledger FOR EACH ROW EXECUTE FUNCTION hanq.forbid_growth_mutation();
