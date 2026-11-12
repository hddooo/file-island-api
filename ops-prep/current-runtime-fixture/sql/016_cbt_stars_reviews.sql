-- Additive: existing exams, answers, scores and device stars are never rewritten.
CREATE TABLE hanq.cbt_question_stars (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 question_id text NOT NULL, version text NOT NULL, starred boolean NOT NULL,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,question_id,version),
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version)
);
-- Keep false rows: an old device import must never resurrect an explicitly cleared star.
CREATE TABLE hanq.cbt_star_imports (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 origin text NOT NULL CHECK(origin IN ('exam','review')), source_id uuid NOT NULL,
 signature text NOT NULL, imported_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,origin,source_id)
);
CREATE TABLE hanq.cbt_reviews (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL, exam_round integer NOT NULL CHECK(exam_round BETWEEN 70 AND 79),
 status text NOT NULL CHECK(status IN ('ready','active','final')),
 current_position integer NOT NULL DEFAULT 0 CHECK(current_position BETWEEN 0 AND 49),
 checkpoint_version integer NOT NULL DEFAULT 0 CHECK(checkpoint_version>=0), pause_submission_key text,
 paused_at timestamptz, created_at timestamptz NOT NULL, started_at timestamptz, final_at timestamptz,
 submission_key text, submission_hash bytea, result jsonb,
 UNIQUE(user_id,idempotency_key), UNIQUE(id,user_id),
 CHECK((status='ready')=(started_at IS NULL)),
 CHECK((status='final')=(final_at IS NOT NULL AND result IS NOT NULL AND submission_key IS NOT NULL AND submission_hash IS NOT NULL))
);
CREATE INDEX cbt_reviews_owner_idx ON hanq.cbt_reviews(user_id,created_at DESC,id);
CREATE TABLE hanq.cbt_review_items (
 review_id uuid NOT NULL, user_id uuid NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 49),
 question_id text NOT NULL, version text NOT NULL, exam_number integer NOT NULL CHECK(exam_number BETWEEN 1 AND 50),
 points integer NOT NULL CHECK(points BETWEEN 1 AND 3), option_ids text[] NOT NULL CHECK(cardinality(option_ids)=5),
 answer_option_id text, correct boolean, answered_at timestamptz, attempt_id uuid UNIQUE REFERENCES hanq.attempts(id),
 PRIMARY KEY(review_id,position), UNIQUE(review_id,question_id),
 FOREIGN KEY(review_id,user_id) REFERENCES hanq.cbt_reviews(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version),
 CHECK(answer_option_id IS NULL OR answer_option_id=ANY(option_ids))
);
ALTER TABLE hanq.attempts ADD COLUMN cbt_review_id uuid REFERENCES hanq.cbt_reviews(id);
CREATE INDEX attempts_cbt_review_idx ON hanq.attempts(cbt_review_id) WHERE cbt_review_id IS NOT NULL;
CREATE FUNCTION hanq.cbt_review_final_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='cbt_reviews' THEN
  IF OLD.status='final' THEN RAISE EXCEPTION 'Final review is immutable'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM hanq.cbt_reviews WHERE id=OLD.review_id AND status='final') THEN RAISE EXCEPTION 'Final review items are immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER cbt_review_final_immutable BEFORE UPDATE OR DELETE ON hanq.cbt_reviews FOR EACH ROW EXECUTE FUNCTION hanq.cbt_review_final_immutable();
CREATE TRIGGER cbt_review_item_final_immutable BEFORE UPDATE OR DELETE ON hanq.cbt_review_items FOR EACH ROW EXECUTE FUNCTION hanq.cbt_review_final_immutable();
