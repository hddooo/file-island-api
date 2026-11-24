-- Study-grounded CBT explanations (지문 분석 · 보기 분석 · 결론), written from the 81st-edition era study material.
-- Private content: served only to signed-in members through the API. One row per official question.
CREATE TABLE hanq.cbt_study_explanations (
 question_id text PRIMARY KEY CHECK(question_id ~ '^exam-[0-9]{2}-[0-9]{2}$'),
 exam_round integer NOT NULL CHECK(exam_round BETWEEN 1 AND 200),
 exam_number integer NOT NULL CHECK(exam_number BETWEEN 1 AND 50),
 version text NOT NULL,
 answer integer NOT NULL CHECK(answer BETWEEN 1 AND 5),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 updated_at timestamptz NOT NULL,
 UNIQUE(exam_round,exam_number)
);
