-- No renaming, retroactive attendance, premium expiry modification or ADMIN assignment.
CREATE TABLE hanq.nickname_claims(nickname_key text PRIMARY KEY,user_id uuid UNIQUE REFERENCES hanq.users(id));
INSERT INTO hanq.nickname_claims(nickname_key,user_id) SELECT lower(btrim(display_name)),CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL END FROM hanq.users GROUP BY lower(btrim(display_name));
CREATE TABLE hanq.attendance(user_id uuid NOT NULL REFERENCES hanq.users(id),day date NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(user_id,day));
CREATE TABLE hanq.free_question_slots(chapter text NOT NULL,kind text NOT NULL CHECK(kind IN ('quiz','mock')),position integer NOT NULL CHECK(position BETWEEN 1 AND 5),question_id text NOT NULL,PRIMARY KEY(chapter,kind,position),UNIQUE(chapter,kind,question_id));
INSERT INTO hanq.free_question_slots(chapter,kind,position,question_id)
 SELECT chapter,kind,n,question_id FROM(SELECT CASE WHEN coalesce(chapter,era) IN ('joseon-early','joseon-late') THEN 'joseon' ELSE coalesce(chapter,era) END chapter,kind,question_id,row_number() OVER(PARTITION BY CASE WHEN coalesce(chapter,era) IN ('joseon-early','joseon-late') THEN 'joseon' ELSE coalesce(chapter,era) END,kind ORDER BY question_id) n FROM hanq.question_versions WHERE is_current) x WHERE n<=5 AND chapter IS NOT NULL;

-- Islands is a related-era catalogue, not a primary exam era.
INSERT INTO hanq.free_question_slots(chapter,kind,position,question_id)
 SELECT 'islands',kind,n,question_id FROM(SELECT kind,question_id,row_number() OVER(PARTITION BY kind ORDER BY question_id) n FROM hanq.question_versions WHERE is_current AND kind='mock' AND 'islands'=ANY(related_eras)) x WHERE n<=5 ON CONFLICT DO NOTHING;
