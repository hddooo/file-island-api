-- Additive, isolated from attempts, CBT, wrong notes and growth. No backfill or deletion.
CREATE TABLE hanq.source_blank_progress (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 quiz_id text NOT NULL, source_version text NOT NULL,
 revision integer NOT NULL CHECK(revision > 0),
 progress jsonb NOT NULL,
 mutation_id uuid NOT NULL, mutation_hash text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,quiz_id,source_version)
);
