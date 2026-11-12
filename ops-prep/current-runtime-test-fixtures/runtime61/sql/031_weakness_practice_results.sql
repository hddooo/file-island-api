-- Immutable first-submission summary; attempt history remains append-only.
CREATE TABLE hanq.weakness_practice_results (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 bank_id text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,bank_id)
);
