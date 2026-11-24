-- Uigeumbu (의금부) triple stars (★★★): the owner's own review marks, separate from CBT exam/review stars.
-- Additive only. One row per owner and question; clearing keeps the row as false.
CREATE TABLE hanq.uigeumbu_stars (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 question_id text NOT NULL,
 version text NOT NULL,
 starred boolean NOT NULL,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,question_id),
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version)
);
CREATE INDEX uigeumbu_stars_owner_starred_idx ON hanq.uigeumbu_stars(user_id) WHERE starred;
