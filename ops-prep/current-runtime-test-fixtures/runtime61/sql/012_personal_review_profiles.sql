-- Content enrollment only. This creates no question, attempt, wrong-note membership,
-- points or replay queue. Activation is a separate owner-verified operation.
CREATE TABLE hanq.personal_review_profiles (
 user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 era text NOT NULL CHECK(era='goryeo'),
 content_key text NOT NULL CHECK(content_key='goryeo-book-22-v1'),
 activated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,era)
);
