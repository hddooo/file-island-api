-- One-question feedback is append-only and independent of optional batch exams.
CREATE TABLE hanq.toeic_cbt_practice_answers (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 question_number integer NOT NULL CHECK(question_number BETWEEN 1 AND 200),
 selected_option text NOT NULL CHECK(selected_option IN ('A','B','C','D')),
 answer_verified boolean NOT NULL,
 correct boolean,
 request_key text NOT NULL,
 created_at timestamptz NOT NULL,
 UNIQUE(user_id,request_key),
 FOREIGN KEY(collection_id,user_id) REFERENCES hanq.toeic_cbt_collections(id,user_id),
 CHECK(answer_verified OR correct IS NULL)
);
CREATE INDEX toeic_practice_owner ON hanq.toeic_cbt_practice_answers(user_id,created_at DESC);
CREATE FUNCTION hanq.toeic_practice_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TOEIC question feedback records are immutable'; END $$;
CREATE TRIGGER toeic_practice_immutable BEFORE UPDATE OR DELETE ON hanq.toeic_cbt_practice_answers FOR EACH ROW EXECUTE FUNCTION hanq.toeic_practice_immutable();
REVOKE ALL ON hanq.toeic_cbt_practice_answers FROM PUBLIC;
