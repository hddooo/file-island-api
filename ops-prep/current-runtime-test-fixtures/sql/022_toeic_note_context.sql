-- Vocabulary-only refinement: preserve the five known Parts and allow genuinely unknown classification.
-- No CBT tables, seed, question import or learner answer changes.
ALTER TABLE hanq.toeic_notes ADD COLUMN translation text NOT NULL DEFAULT '' CHECK(length(translation)<=6000);
ALTER TABLE hanq.toeic_notes ADD COLUMN part_of_speech text NOT NULL DEFAULT '' CHECK(length(part_of_speech)<=30);
ALTER TABLE hanq.toeic_notes ADD COLUMN synonyms jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(synonyms)='array' AND jsonb_array_length(synonyms)<=3);
ALTER TABLE hanq.toeic_notes DROP CONSTRAINT toeic_notes_part_check;
ALTER TABLE hanq.toeic_notes ADD CONSTRAINT toeic_notes_part_check CHECK(part IN ('1','2','3-4','5-6','7','unclassified'));
ALTER TABLE hanq.toeic_recall_view DROP CONSTRAINT toeic_recall_view_part_check;
ALTER TABLE hanq.toeic_recall_view ADD CONSTRAINT toeic_recall_view_part_check CHECK(part IN ('','1','2','3-4','5-6','7','unclassified'));
