-- HanQ private schema. Everything lives in hanq (never in "public"), so Supabase's PostgREST
-- (which exposes "public" by default) cannot reach auth, answers or payments. Privileges are re-tightened by
-- migrations/repeatable/privileges.sql after every migrate run. All names are schema-qualified.
-- Timestamps come from the application clock (parameters), not now(), so behaviour is testable and consistent.

CREATE TABLE hanq.users (
  id                  uuid PRIMARY KEY,
  email_normalized    text NOT NULL UNIQUE CHECK (char_length(email_normalized) BETWEEN 3 AND 254),
  email_display       text NOT NULL CHECK (char_length(email_display) BETWEEN 3 AND 254),
  password_hash       text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  display_name        text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  password_changed_at timestamptz NOT NULL
);

-- One family per sign-in. Access tokens carry the family id (sid) and are rejected once it is revoked/expired.
CREATE TABLE hanq.session_families (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('logout', 'logout-all', 'replay', 'password-change')),
  CHECK (expires_at > created_at)
);
CREATE INDEX session_families_user_idx ON hanq.session_families (user_id);

-- Rotating refresh tokens: only SHA-256(jti) is stored. A used token presented again = replay → family revoked.
CREATE TABLE hanq.refresh_tokens (
  id          uuid PRIMARY KEY,
  family_id   uuid NOT NULL REFERENCES hanq.session_families(id) ON DELETE CASCADE,
  jti_hash    bytea NOT NULL UNIQUE CHECK (octet_length(jti_hash) = 32),
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  replaced_by uuid,
  CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_family_idx ON hanq.refresh_tokens (family_id);

-- Failed sign-ins per hashed e-mail (shared across API instances; complements the per-IP throttler).
CREATE TABLE hanq.auth_login_failures (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_key  bytea NOT NULL CHECK (octet_length(email_key) = 32),
  created_at timestamptz NOT NULL
);
CREATE INDEX auth_login_failures_key_idx ON hanq.auth_login_failures (email_key, created_at);

-- Question versions seeded from the static front (quiz-catalog.js · exam-pool.js). A (question_id, version) row is
-- immutable; a changed catalog adds a new version and moves is_current. Answers live only in private columns.
CREATE TABLE hanq.question_versions (
  question_id       text NOT NULL CHECK (question_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'),
  version           text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 80),
  kind              text NOT NULL CHECK (kind IN ('quiz', 'mock')),
  is_current        boolean NOT NULL DEFAULT false,
  chapter           text,
  era               text,
  related_eras      text[] NOT NULL DEFAULT '{}',
  exam_round        integer,
  exam_number       integer,
  points            integer NOT NULL CHECK (points BETWEEN 1 AND 3),
  option_ids        text[] NOT NULL CHECK (cardinality(option_ids) BETWEEN 2 AND 6),
  correct_option_id text NOT NULL,
  public_payload    jsonb NOT NULL,
  review_payload    jsonb NOT NULL,
  content_hash      text NOT NULL CHECK (char_length(content_hash) = 64),
  seeded_at         timestamptz NOT NULL,
  PRIMARY KEY (question_id, version),
  CHECK (correct_option_id = ANY (option_ids)),
  CHECK (kind <> 'mock' OR (exam_round IS NOT NULL AND exam_number IS NOT NULL AND cardinality(option_ids) = 5))
);
CREATE UNIQUE INDEX question_versions_current_uq ON hanq.question_versions (question_id) WHERE is_current;
CREATE INDEX question_versions_kind_idx ON hanq.question_versions (kind, is_current, question_id);

CREATE TABLE hanq.replays (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
  list        text NOT NULL CHECK (list IN ('unresolved', 'all')),
  ord         text NOT NULL CHECK (ord IN ('recent', 'random')),
  size        integer NOT NULL CHECK (size BETWEEN 1 AND 100),
  created_at  timestamptz NOT NULL,
  finished_at timestamptz
);
CREATE INDEX replays_user_idx ON hanq.replays (user_id, created_at DESC);

CREATE TABLE hanq.runs (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
  seq           integer NOT NULL CHECK (seq >= 1),
  product       text NOT NULL CHECK (product IN ('personal-mini', 'personal-formal')),
  size          integer NOT NULL CHECK (size IN (20, 50)),
  duration_ms   integer NOT NULL CHECK (duration_ms > 0 AND duration_ms % 60000 = 0),
  status        text NOT NULL CHECK (status IN ('ready', 'active', 'final')),
  selection     jsonb NOT NULL,
  created_at    timestamptz NOT NULL,
  started_at    timestamptz,
  ends_at       timestamptz,
  final_at      timestamptz,
  final_reason  text CHECK (final_reason IN ('submit', 'expired')),
  score         jsonb,
  UNIQUE (user_id, seq),
  CHECK ((status = 'ready') = (started_at IS NULL)),
  CHECK (status <> 'final' OR (final_at IS NOT NULL AND final_reason IS NOT NULL AND score IS NOT NULL))
);
CREATE INDEX runs_user_idx ON hanq.runs (user_id, created_at DESC);

-- Attempts: one immutable graded answer. submission_id is unique per user (idempotent retries, conflicting payloads rejected).
CREATE TABLE hanq.attempts (
  id            uuid PRIMARY KEY,
  seq           bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id       uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
  submission_id text NOT NULL CHECK (submission_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
  question_id   text NOT NULL,
  version       text NOT NULL,
  option_id     text,
  correct       boolean NOT NULL,
  source        text NOT NULL CHECK (source IN ('practice', 'wrong-replay', 'run', 'import')),
  replay_id     uuid REFERENCES hanq.replays(id) ON DELETE SET NULL,
  run_id        uuid REFERENCES hanq.runs(id) ON DELETE SET NULL,
  payload_hash  bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  reported_at   timestamptz,
  created_at    timestamptz NOT NULL,
  FOREIGN KEY (question_id, version) REFERENCES hanq.question_versions (question_id, version),
  UNIQUE (user_id, submission_id),
  CHECK (option_id IS NOT NULL OR (source = 'run' AND correct = false)),
  CHECK (reported_at IS NULL OR source = 'import')
);
CREATE INDEX attempts_user_seq_idx ON hanq.attempts (user_id, seq DESC);
CREATE INDEX attempts_user_question_idx ON hanq.attempts (user_id, question_id, seq DESC);

CREATE TABLE hanq.replay_items (
  replay_id   uuid NOT NULL REFERENCES hanq.replays(id) ON DELETE CASCADE,
  position    integer NOT NULL CHECK (position >= 0),
  question_id text NOT NULL,
  version     text NOT NULL,
  option_ids  text[] NOT NULL,
  attempt_id  uuid REFERENCES hanq.attempts(id),
  PRIMARY KEY (replay_id, position),
  FOREIGN KEY (question_id, version) REFERENCES hanq.question_versions (question_id, version)
);

CREATE TABLE hanq.run_items (
  run_id           uuid NOT NULL REFERENCES hanq.runs(id) ON DELETE CASCADE,
  position         integer NOT NULL CHECK (position >= 0),
  question_id      text NOT NULL,
  version          text NOT NULL,
  origin           text NOT NULL CHECK (origin IN ('wrong-quiz', 'wrong-mock', 'fill')),
  points           integer NOT NULL CHECK (points BETWEEN 1 AND 3),
  points_kind      text NOT NULL CHECK (points_kind IN ('official', 'practice')),
  option_ids       text[] NOT NULL,
  answer_option_id text,
  answered_at      timestamptz,
  correct          boolean,
  attempt_id       uuid REFERENCES hanq.attempts(id),
  PRIMARY KEY (run_id, position),
  UNIQUE (run_id, question_id),
  FOREIGN KEY (question_id, version) REFERENCES hanq.question_versions (question_id, version),
  CHECK (answer_option_id IS NULL OR answer_option_id = ANY (option_ids))
);

-- Local-record import: a browser's random import key is bound to the FIRST user that imports with it.
CREATE TABLE hanq.import_batches (
  batch_key  bytea PRIMARY KEY CHECK (octet_length(batch_key) = 32),
  user_id    uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  accepted   integer NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  received   integer NOT NULL DEFAULT 0 CHECK (received >= 0)
);

-- Payments: order amount/currency/owner are fixed by the server when the order is created.
CREATE TABLE hanq.payment_orders (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES hanq.users(id),
  order_ref    text NOT NULL UNIQUE CHECK (order_ref ~ '^hq_[A-Za-z0-9_-]{16,64}$'),
  plan_id      text NOT NULL CHECK (plan_id IN ('premium-1m')),
  amount       integer NOT NULL CHECK (amount > 0),
  currency     text NOT NULL CHECK (currency = 'KRW'),
  provider     text NOT NULL CHECK (provider IN ('test')),
  status       text NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  failure_code text,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  paid_at      timestamptz,
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX payment_orders_user_idx ON hanq.payment_orders (user_id, created_at DESC);

CREATE TABLE hanq.payments (
  id                  uuid PRIMARY KEY,
  order_id            uuid NOT NULL UNIQUE REFERENCES hanq.payment_orders(id),
  provider            text NOT NULL,
  provider_payment_id text NOT NULL CHECK (char_length(provider_payment_id) BETWEEN 1 AND 200),
  amount              integer NOT NULL,
  currency            text NOT NULL,
  verified_at         timestamptz NOT NULL,
  UNIQUE (provider, provider_payment_id)
);

CREATE TABLE hanq.payment_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES hanq.payment_orders(id),
  kind       text NOT NULL CHECK (kind IN ('created', 'declined', 'mismatch', 'paid', 'duplicate')),
  detail     text,
  created_at timestamptz NOT NULL
);

-- Premium: current expiry per user (row is the lock target) + append-only ledger (one grant per payment, ever).
CREATE TABLE hanq.premium_state (
  user_id    uuid PRIMARY KEY REFERENCES hanq.users(id),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE TABLE hanq.entitlement_ledger (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES hanq.users(id),
  payment_id    uuid NOT NULL UNIQUE REFERENCES hanq.payments(id),
  plan_id       text NOT NULL,
  period_policy text NOT NULL CHECK (period_policy IN ('calendar-month', 'fixed-days')),
  granted_from  timestamptz NOT NULL,
  granted_until timestamptz NOT NULL,
  created_at    timestamptz NOT NULL,
  CHECK (granted_until > granted_from)
);
CREATE INDEX entitlement_ledger_user_idx ON hanq.entitlement_ledger (user_id, created_at);

CREATE FUNCTION hanq.forbid_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hanq.entitlement_ledger is append-only';
END
$$;

CREATE TRIGGER entitlement_ledger_append_only
  BEFORE UPDATE OR DELETE ON hanq.entitlement_ledger
  FOR EACH ROW EXECUTE FUNCTION hanq.forbid_ledger_mutation();
