-- Private TOEIC replay only. No history questions/attempts/rewards or vocabulary data are altered.
CREATE TABLE hanq.toeic_cbt_collections (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 source_key text NOT NULL, version text NOT NULL, title text NOT NULL, content jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,user_id), UNIQUE(user_id,source_key,version)
);
CREATE TABLE hanq.toeic_cbt_runs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES hanq.users(id) ON DELETE CASCADE,
 collection_id uuid NOT NULL,idempotency_key text NOT NULL,
 status text NOT NULL CHECK(status IN ('ready','active','final')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),cursor integer NOT NULL DEFAULT 0 CHECK(cursor>=0),
 paused boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL,started_at timestamptz,final_at timestamptz,
 submission_key text,submission_hash text,result jsonb,
 UNIQUE(id,user_id),UNIQUE(user_id,idempotency_key),
 FOREIGN KEY(collection_id,user_id) REFERENCES hanq.toeic_cbt_collections(id,user_id),
 CHECK((status='ready')=(started_at IS NULL)),
 CHECK((status='final')=(final_at IS NOT NULL AND submission_key IS NOT NULL AND submission_hash IS NOT NULL AND result IS NOT NULL)),
 CHECK(NOT paused OR status='active')
);
CREATE INDEX toeic_cbt_runs_owner ON hanq.toeic_cbt_runs(user_id,created_at DESC,id);
CREATE TABLE hanq.toeic_cbt_items (
 run_id uuid NOT NULL,user_id uuid NOT NULL,position integer NOT NULL CHECK(position>=0),
 question_number integer NOT NULL CHECK(question_number BETWEEN 1 AND 200),
 selected_option text CHECK(selected_option IN ('A','B','C','D')),correct boolean,
 PRIMARY KEY(run_id,position),UNIQUE(run_id,question_number),
 FOREIGN KEY(run_id,user_id) REFERENCES hanq.toeic_cbt_runs(id,user_id) ON DELETE CASCADE,
 CHECK(correct IS NULL OR selected_option IS NOT NULL)
);
CREATE FUNCTION hanq.toeic_cbt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='toeic_cbt_collections' THEN RAISE EXCEPTION 'TOEIC source versions are immutable';
 ELSIF TG_TABLE_NAME='toeic_cbt_runs' THEN
  IF OLD.status='final' THEN RAISE EXCEPTION 'Final TOEIC run is immutable'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM hanq.toeic_cbt_runs WHERE id=OLD.run_id AND status='final') THEN RAISE EXCEPTION 'Final TOEIC items are immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER toeic_source_immutable BEFORE UPDATE ON hanq.toeic_cbt_collections FOR EACH ROW EXECUTE FUNCTION hanq.toeic_cbt_immutable();
CREATE TRIGGER toeic_run_immutable BEFORE UPDATE OR DELETE ON hanq.toeic_cbt_runs FOR EACH ROW EXECUTE FUNCTION hanq.toeic_cbt_immutable();
CREATE TRIGGER toeic_item_immutable BEFORE UPDATE OR DELETE ON hanq.toeic_cbt_items FOR EACH ROW EXECUTE FUNCTION hanq.toeic_cbt_immutable();
