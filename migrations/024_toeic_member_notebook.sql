-- One explicitly published owner notebook; no users or notes are copied or exposed by default.
CREATE TABLE hanq.toeic_member_notebook (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 owner_id uuid NOT NULL REFERENCES hanq.users(id),
 published_at timestamptz NOT NULL DEFAULT now()
);
