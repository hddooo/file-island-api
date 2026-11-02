-- Book-reported wrong questions are personal memberships, never fabricated attempts.
CREATE TABLE hanq.manual_wrong_notes (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 question_id text NOT NULL,
 version text NOT NULL,
 source text NOT NULL DEFAULT 'book-manual' CHECK(source='book-manual'),
 source_key text NOT NULL CHECK(char_length(source_key) BETWEEN 1 AND 160),
 review_payload jsonb NOT NULL CHECK(jsonb_typeof(review_payload)='object'),
 added_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,question_id),
 FOREIGN KEY(question_id,version) REFERENCES hanq.question_versions(question_id,version)
);
CREATE INDEX manual_wrong_notes_owner_added ON hanq.manual_wrong_notes(user_id,added_at DESC);

-- Existing replay queues retain their exact items and nullable legacy part.
ALTER TABLE hanq.replays ADD COLUMN part text CHECK(part IN('ancient','prehistory','gojoseon','samguk','nambuk','goryeo','joseon','joseon-early','joseon-late','opening','colonial','modern','islands'));
