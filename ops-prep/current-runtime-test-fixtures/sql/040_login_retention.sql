-- Additive; existing sessions retain their original policy.
ALTER TABLE hanq.session_families ADD COLUMN retention_mode text NOT NULL DEFAULT 'legacy' CHECK (retention_mode IN ('legacy', 'remember-90d'));
ALTER TABLE hanq.session_families ADD CONSTRAINT session_remember_absolute_cap CHECK (retention_mode <> 'remember-90d' OR expires_at <= created_at + interval '7776000 seconds');
