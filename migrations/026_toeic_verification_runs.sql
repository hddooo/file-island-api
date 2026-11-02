-- Annotate deployment checks separately without changing immutable runs/items.
-- No public HTTP write endpoint; explicit owner-verified operational annotation only.
CREATE TABLE hanq.toeic_cbt_verification_runs (
 user_id uuid NOT NULL,
 run_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose='deployment-verification'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,run_id),
 FOREIGN KEY(run_id,user_id) REFERENCES hanq.toeic_cbt_runs(id,user_id)
);
REVOKE ALL ON hanq.toeic_cbt_verification_runs FROM PUBLIC;
