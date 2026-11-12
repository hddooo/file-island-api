-- Shared source reference, personal immutable answers. No existing rows are rewritten.
ALTER TABLE hanq.toeic_cbt_practice_answers
 DROP CONSTRAINT toeic_cbt_practice_answers_collection_id_user_id_fkey,
 ADD CONSTRAINT toeic_practice_collection_ref FOREIGN KEY(collection_id) REFERENCES hanq.toeic_cbt_collections(id),
 ADD CONSTRAINT toeic_practice_viewer_ref FOREIGN KEY(user_id) REFERENCES hanq.users(id);
-- A personal answer may reference only an owned source or the explicitly published source owner.
CREATE FUNCTION hanq.toeic_practice_source_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hanq.toeic_cbt_collections c WHERE c.id=NEW.collection_id AND
  (c.user_id=NEW.user_id OR c.user_id=(SELECT owner_id FROM hanq.toeic_member_notebook WHERE singleton=true))) THEN
  RAISE EXCEPTION 'TOEIC source is not available to this viewer' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER toeic_practice_source_scope BEFORE INSERT ON hanq.toeic_cbt_practice_answers
 FOR EACH ROW EXECUTE FUNCTION hanq.toeic_practice_source_scope();
