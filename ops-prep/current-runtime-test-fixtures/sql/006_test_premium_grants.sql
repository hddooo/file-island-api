-- Test free pass audit: at most one claim per user (user_id is the primary key), at least 30 days long.
-- Not a payment: no rows in payments, orders or entitlement_ledger. premium_state alone carries the expiry.
-- Rows are immutable once written. Role privileges are applied by the existing repeatable migration.
CREATE TABLE hanq.test_premium_grants (
  user_id       uuid        PRIMARY KEY REFERENCES hanq.users (id),
  granted_from  timestamptz NOT NULL,
  granted_until timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_premium_grants_min_period CHECK (granted_until >= granted_from + interval '30 days')
);

CREATE FUNCTION hanq.test_premium_grants_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hanq.test_premium_grants rows are immutable';
END;
$$;

CREATE TRIGGER test_premium_grants_no_update
  BEFORE UPDATE OR DELETE ON hanq.test_premium_grants
  FOR EACH ROW EXECUTE FUNCTION hanq.test_premium_grants_immutable();
