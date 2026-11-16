-- User-reported completed paper exams: no fabricated answers, online clocks, attempts, or XP.
CREATE TABLE hanq.paper_exam_results (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
 exam_round integer NOT NULL CHECK (exam_round BETWEEN 70 AND 80),
 source text NOT NULL DEFAULT 'paper-reported' CHECK(source='paper-reported'),
 reported_at timestamptz NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 score integer NOT NULL CHECK(score BETWEEN 0 AND 100),
 correct_count integer NOT NULL CHECK(correct_count BETWEEN 0 AND 50),
 wrong_numbers integer[] NOT NULL CHECK(cardinality(wrong_numbers)<=50),
 CHECK(correct_count=50-cardinality(wrong_numbers)),
 UNIQUE(user_id,idempotency_key), UNIQUE(id,user_id)
);
CREATE INDEX paper_exam_results_owner ON hanq.paper_exam_results(user_id,reported_at DESC,id);
CREATE TABLE hanq.paper_exam_result_items (
 result_id uuid NOT NULL,
 user_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 0 AND 49),
 question_id text NOT NULL,
 version text NOT NULL,
 exam_number integer NOT NULL CHECK(exam_number=position+1),
 points integer NOT NULL CHECK(points BETWEEN 1 AND 3),
 reported_correct boolean NOT NULL,
 PRIMARY KEY(result_id,position),
 UNIQUE(result_id,question_id),
 FOREIGN KEY(result_id,user_id) REFERENCES hanq.paper_exam_results(id,user_id),
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version)
);
CREATE INDEX paper_exam_items_owner ON hanq.paper_exam_result_items(user_id,question_id);
-- Reported evidence is append-only. Corrections require a separate audited feature, not rewriting a run.
CREATE FUNCTION hanq.paper_result_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'paper-reported results are immutable'; END $$;
CREATE TRIGGER paper_result_immutable BEFORE UPDATE OR DELETE ON hanq.paper_exam_results
 FOR EACH ROW EXECUTE FUNCTION hanq.paper_result_immutable();
CREATE TRIGGER paper_item_immutable BEFORE UPDATE OR DELETE ON hanq.paper_exam_result_items
 FOR EACH ROW EXECUTE FUNCTION hanq.paper_result_immutable();
