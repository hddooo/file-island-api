-- Persist only actually issued battle rounds; no backfill or learning-record changes.
CREATE TABLE hanq.battle_rounds (
 match_id uuid NOT NULL REFERENCES hanq.battle_matches(id), round_no integer NOT NULL CHECK(round_no>0),
 started_at timestamptz NOT NULL, content jsonb NOT NULL, submissions jsonb NOT NULL,
 PRIMARY KEY(match_id,round_no)
);
