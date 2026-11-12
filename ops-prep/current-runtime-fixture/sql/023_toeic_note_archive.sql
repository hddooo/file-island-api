-- Reversible notebook archive; preserve note IDs, content and all recall records.
ALTER TABLE hanq.toeic_notes ADD COLUMN archived_at timestamptz;
