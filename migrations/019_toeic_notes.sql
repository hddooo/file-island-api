-- Additive private notebook; no history/attempt tables or existing learner data are changed.
CREATE TABLE hanq.toeic_notes (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 part text NOT NULL CHECK (part IN ('1','2','3-4','5-6','7')),
 expression text NOT NULL CHECK (length(expression) BETWEEN 1 AND 300),
 expression_key text NOT NULL,
 meaning text NOT NULL DEFAULT '', structure text NOT NULL DEFAULT '',
 example text NOT NULL DEFAULT '', confusion text NOT NULL DEFAULT '',
 source_text text NOT NULL DEFAULT '', source_reference text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,id), UNIQUE (user_id,part,expression_key)
);
