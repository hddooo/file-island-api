CREATE TABLE hanq.toeic_word_checks (
 user_id uuid PRIMARY KEY REFERENCES hanq.users(id),
 ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(ids)='array'),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 legacy_imported boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
