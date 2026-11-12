-- Applied by the migrator (idempotent): right after CREATE SCHEMA, inside every migration transaction before COMMIT,
-- and once more at the end. Keeps schema hanq closed to everyone except the owner role that ran the migrations
-- (and any role you explicitly grant, see docs/security.md). On Supabase the API roles anon / authenticated get nothing.
-- Only objects inside schema hanq are touched; public/auth/storage and other roles are never altered.

REVOKE ALL ON SCHEMA hanq FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA hanq FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA hanq FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hanq FROM PUBLIC;
-- Future objects created by this (migrating) role inside hanq: no default privileges for PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA hanq REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hanq REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hanq REVOKE ALL ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA hanq FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA hanq FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA hanq FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hanq FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA hanq REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA hanq REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA hanq REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;
