-- Additive only: no attempt/history backfill or modification.
CREATE TABLE hanq.wrong_note_review_state (
  user_id uuid NOT NULL REFERENCES hanq.users(id),
  question_id text NOT NULL,
  version text NOT NULL,
  exposure_count integer NOT NULL DEFAULT 0 CHECK (exposure_count >= 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count integer NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  correct_streak integer NOT NULL DEFAULT 0 CHECK (correct_streak >= 0),
  last_shown_at timestamptz,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  PRIMARY KEY (user_id, question_id, version),
  FOREIGN KEY (question_id, version) REFERENCES hanq.question_versions(question_id, version)
);
CREATE UNIQUE INDEX one_open_wrong_note_study ON hanq.runs(user_id)
 WHERE status IN ('ready','active') AND selection->>'mode' = 'wrong-note-study';

-- Keep legacy product sizes; permit shorter wrong-only study sessions without filler.
ALTER TABLE hanq.runs DROP CONSTRAINT runs_size_check;
ALTER TABLE hanq.runs ADD CONSTRAINT runs_size_check CHECK (size IN (20,50) OR (selection->>'mode'='wrong-note-study' AND size BETWEEN 1 AND 20));
