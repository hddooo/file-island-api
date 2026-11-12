-- Separate, account-private re-solving records; immutable battle archives remain untouched.
CREATE TABLE hanq.battle_wrong_attempts (
 user_id uuid NOT NULL REFERENCES hanq.users(id), request_key uuid NOT NULL,
 match_id uuid NOT NULL, round_no integer NOT NULL CHECK(round_no>0),
 item_id text NOT NULL CHECK(length(item_id) BETWEEN 1 AND 120),
 option_id text NOT NULL CHECK(length(option_id) BETWEEN 1 AND 120),
 correct boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_key)
);
CREATE INDEX battle_wrong_attempts_owner_source ON hanq.battle_wrong_attempts(user_id,match_id,round_no,item_id,created_at DESC);
