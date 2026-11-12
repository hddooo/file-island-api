-- A server-owned practice opponent is not an account and can never earn or spend XP.
CREATE TABLE hanq.battle_practice_matches (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES hanq.users(id),
 status text NOT NULL CHECK(status IN('ready','playing','between','finished','void')),
 state jsonb NOT NULL,
 question_bank jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX battle_practice_one_active ON hanq.battle_practice_matches(owner_id)
 WHERE status IN('ready','playing','between');
CREATE INDEX battle_practice_history ON hanq.battle_practice_matches(owner_id,created_at DESC,id DESC);
CREATE TABLE hanq.battle_practice_rounds (
 match_id uuid NOT NULL REFERENCES hanq.battle_practice_matches(id),
 round_no integer NOT NULL CHECK(round_no>0),
 started_at timestamptz NOT NULL,
 content jsonb NOT NULL,
 submissions jsonb NOT NULL,
 PRIMARY KEY(match_id,round_no)
);
