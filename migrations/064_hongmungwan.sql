-- Independent Hongmungwan practice. Additive: old attempts, XP and manual sources remain intact.
CREATE TABLE hanq.hongmungwan_answers (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 question_id text NOT NULL, version text NOT NULL,
 submission_id text NOT NULL, option_id text NOT NULL, correct boolean NOT NULL,
 created_at timestamptz NOT NULL,
 UNIQUE(user_id,submission_id),
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version)
);
CREATE INDEX hongmungwan_answers_recent ON hanq.hongmungwan_answers(user_id,question_id,version,id DESC);
CREATE TABLE hanq.hongmungwan_stars (
 user_id uuid NOT NULL REFERENCES hanq.users(id), question_id text NOT NULL,
 version text NOT NULL, starred boolean NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,question_id,version),
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version)
);
