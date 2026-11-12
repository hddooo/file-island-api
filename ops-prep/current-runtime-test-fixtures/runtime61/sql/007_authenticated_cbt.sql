-- Authenticated official-round CBT (rounds 70–79, 50 original questions, 80 minutes on the server clock).
-- Additive only: no question, attempt, wrong-note, growth or entitlement rows are modified or backfilled.
-- Items reference the exact (question_id, version) shown, so historical versions stay linked after re-seeding.

CREATE TABLE hanq.cbt_runs (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
  exam_round       integer NOT NULL CHECK (exam_round BETWEEN 70 AND 79),
  status           text NOT NULL CHECK (status IN ('ready', 'active', 'final')),
  duration_ms      integer NOT NULL CHECK (duration_ms = 4800000),
  current_position integer NOT NULL DEFAULT 0 CHECK (current_position BETWEEN 0 AND 49),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  started_at       timestamptz,
  ends_at          timestamptz,
  final_at         timestamptz,
  final_reason     text CHECK (final_reason IN ('submit', 'expired')),
  result           jsonb,
  UNIQUE (user_id, idempotency_key),
  UNIQUE (id, user_id),
  CHECK ((status = 'ready') = (started_at IS NULL)),
  CHECK (started_at IS NULL OR ends_at = started_at + make_interval(secs => duration_ms / 1000)),
  CHECK ((status = 'final') = (final_at IS NOT NULL AND final_reason IS NOT NULL AND result IS NOT NULL)),
  CHECK (final_at IS NULL OR final_at <= ends_at)
);
CREATE INDEX cbt_runs_user_idx ON hanq.cbt_runs (user_id, created_at DESC, id);
CREATE INDEX cbt_runs_due_idx ON hanq.cbt_runs (user_id, ends_at) WHERE status = 'active';

CREATE TABLE hanq.cbt_run_items (
  run_id           uuid NOT NULL,
  user_id          uuid NOT NULL,
  position         integer NOT NULL CHECK (position BETWEEN 0 AND 49),
  question_id      text NOT NULL,
  version          text NOT NULL,
  exam_number      integer NOT NULL CHECK (exam_number BETWEEN 1 AND 50),
  points           integer NOT NULL CHECK (points BETWEEN 1 AND 3),
  option_ids       text[] NOT NULL CHECK (cardinality(option_ids) = 5),
  answer_option_id text,
  answered_at      timestamptz,
  correct          boolean,
  attempt_id       uuid REFERENCES hanq.attempts(id),
  PRIMARY KEY (run_id, position),
  UNIQUE (run_id, question_id),
  UNIQUE (run_id, exam_number),
  FOREIGN KEY (run_id, user_id) REFERENCES hanq.cbt_runs (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (question_id, version) REFERENCES hanq.question_versions (question_id, version),
  CHECK (answer_option_id IS NULL OR answer_option_id = ANY (option_ids)),
  CHECK ((answer_option_id IS NULL) = (answered_at IS NULL))
);

-- Optional link from the 50 graded attempts back to their CBT run (attempts.run_id stays reserved for hanq.runs).
ALTER TABLE hanq.attempts ADD COLUMN cbt_run_id uuid REFERENCES hanq.cbt_runs(id) ON DELETE SET NULL;
CREATE INDEX attempts_cbt_run_idx ON hanq.attempts (cbt_run_id) WHERE cbt_run_id IS NOT NULL;

-- A graded run and its items are immutable.
CREATE FUNCTION hanq.cbt_run_final_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'hanq.cbt_runs: a final run is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cbt_runs_final_immutable BEFORE UPDATE OR DELETE ON hanq.cbt_runs
  FOR EACH ROW EXECUTE FUNCTION hanq.cbt_run_final_immutable();

CREATE FUNCTION hanq.cbt_item_final_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hanq.cbt_runs WHERE id = OLD.run_id AND status = 'final') THEN
    RAISE EXCEPTION 'hanq.cbt_run_items: items of a final run are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cbt_items_final_immutable BEFORE UPDATE OR DELETE ON hanq.cbt_run_items
  FOR EACH ROW EXECUTE FUNCTION hanq.cbt_item_final_immutable();
