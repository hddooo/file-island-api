-- Additive v2 batched/editable source practice. Legacy source progress and CBT records remain unchanged.
CREATE TABLE hanq.source_blank_workspaces (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 quiz_id text NOT NULL, source_version text NOT NULL,
 revision integer NOT NULL CHECK(revision > 0), workspace jsonb NOT NULL,
 mutation_id uuid NOT NULL, mutation_hash text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,quiz_id,source_version)
);
