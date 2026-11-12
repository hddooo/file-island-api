-- Preserve every existing member and administrator; only future inserts are pending.
ALTER TABLE hanq.users ADD COLUMN approval_status text NOT NULL DEFAULT 'approved'
 CHECK (approval_status IN ('pending','approved','rejected'));
ALTER TABLE hanq.users ALTER COLUMN approval_status SET DEFAULT 'pending';
ALTER TABLE hanq.users ADD COLUMN approval_decided_at timestamptz;
ALTER TABLE hanq.users ADD COLUMN approval_decided_by uuid REFERENCES hanq.users(id);
CREATE INDEX users_approval_queue ON hanq.users(approval_status,created_at,id);
