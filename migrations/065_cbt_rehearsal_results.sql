-- Private, client-reported learning snapshots. Not grading, attempts, or XP.
CREATE TABLE hanq.cbt_rehearsal_results (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 exam_round integer NOT NULL CHECK(exam_round BETWEEN 70 AND 80),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 submitted_at timestamptz NOT NULL,
 reset_at timestamptz,
 PRIMARY KEY(user_id,exam_round)
);
