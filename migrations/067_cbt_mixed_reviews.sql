-- Uigeumbu (의금부): owner-scoped untimed sessions that mix wrong questions from every official CBT round.
-- Additive only: existing exams, reviews, attempts, stars, scores and growth rows are never rewritten.
-- Sessions record their own answers; they append no attempts and award or deduct no growth.
CREATE TABLE hanq.cbt_mixed_reviews (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 140),
 scope text NOT NULL CHECK(scope IN ('all','last-wrong','round-review')),
 parent_id uuid,
 status text NOT NULL CHECK(status IN ('active','final','abandoned')),
 current_position integer NOT NULL DEFAULT 0 CHECK(current_position BETWEEN 0 AND 699),
 created_at timestamptz NOT NULL,
 final_at timestamptz,
 result jsonb,
 UNIQUE(user_id,idempotency_key), UNIQUE(id,user_id),
 FOREIGN KEY(parent_id,user_id) REFERENCES hanq.cbt_mixed_reviews(id,user_id) ON DELETE CASCADE,
 CHECK((scope='round-review')=(parent_id IS NOT NULL)),
 CHECK((status='final')=(final_at IS NOT NULL AND result IS NOT NULL))
);
CREATE INDEX cbt_mixed_reviews_owner_idx ON hanq.cbt_mixed_reviews(user_id,created_at DESC,id);
CREATE INDEX cbt_mixed_reviews_parent_idx ON hanq.cbt_mixed_reviews(parent_id,created_at DESC) WHERE parent_id IS NOT NULL;
CREATE TABLE hanq.cbt_mixed_review_items (
 review_id uuid NOT NULL,
 user_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 699),
 question_id text NOT NULL,
 version text NOT NULL,
 exam_round integer NOT NULL CHECK(exam_round BETWEEN 1 AND 200),
 exam_number integer NOT NULL CHECK(exam_number BETWEEN 1 AND 50),
 points integer NOT NULL CHECK(points BETWEEN 1 AND 3),
 option_ids text[] NOT NULL CHECK(cardinality(option_ids)=5),
 answer_option_id text,
 checked boolean NOT NULL DEFAULT false,
 correct boolean,
 answered_at timestamptz,
 PRIMARY KEY(review_id,position), UNIQUE(review_id,question_id),
 FOREIGN KEY(review_id,user_id) REFERENCES hanq.cbt_mixed_reviews(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version),
 CHECK(answer_option_id IS NULL OR answer_option_id=ANY(option_ids)),
 CHECK(NOT checked OR answer_option_id IS NOT NULL)
);
CREATE FUNCTION hanq.cbt_mixed_review_final_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='cbt_mixed_reviews' THEN
  IF OLD.status IN ('final','abandoned') THEN RAISE EXCEPTION 'Closed uigeumbu session is immutable'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM hanq.cbt_mixed_reviews WHERE id=OLD.review_id AND status IN ('final','abandoned')) THEN RAISE EXCEPTION 'Closed uigeumbu session items are immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER cbt_mixed_review_final_immutable BEFORE UPDATE OR DELETE ON hanq.cbt_mixed_reviews FOR EACH ROW EXECUTE FUNCTION hanq.cbt_mixed_review_final_immutable();
CREATE TRIGGER cbt_mixed_review_item_final_immutable BEFORE UPDATE OR DELETE ON hanq.cbt_mixed_review_items FOR EACH ROW EXECUTE FUNCTION hanq.cbt_mixed_review_final_immutable();
