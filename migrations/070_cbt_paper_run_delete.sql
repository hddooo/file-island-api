-- A self-reported paper result (result has paperImportHash) may be deleted by its owner.
-- It has no attempts, no growth row and no XP. Every other final run stays immutable, and UPDATE stays blocked for all.
CREATE OR REPLACE FUNCTION hanq.cbt_run_final_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'final' AND NOT (TG_OP = 'DELETE' AND coalesce(OLD.result, '{}'::jsonb) ? 'paperImportHash') THEN
    RAISE EXCEPTION 'hanq.cbt_runs: a final run is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION hanq.cbt_item_final_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hanq.cbt_runs WHERE id = OLD.run_id AND status = 'final'
             AND NOT (TG_OP = 'DELETE' AND coalesce(result, '{}'::jsonb) ? 'paperImportHash')) THEN
    RAISE EXCEPTION 'hanq.cbt_run_items: items of a final run are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
