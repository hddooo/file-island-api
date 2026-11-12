-- Account-owned direct recall only; no grading or history/points mutations.
CREATE TABLE hanq.toeic_recall_progress (
 user_id uuid NOT NULL,
 note_id uuid NOT NULL,
 note_revision integer NOT NULL CHECK(note_revision>0),
 answer text NOT NULL DEFAULT '' CHECK(length(answer)<=6000),
 revealed boolean NOT NULL DEFAULT false,
 evaluation text NOT NULL DEFAULT '' CHECK(evaluation IN ('','known','review')),
 revision integer NOT NULL CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,note_id),
 FOREIGN KEY(user_id,note_id) REFERENCES hanq.toeic_notes(user_id,id) ON DELETE CASCADE,
 CHECK(NOT revealed OR length(btrim(answer))>0),
 CHECK(evaluation='' OR revealed)
);
CREATE TABLE hanq.toeic_recall_view (
 user_id uuid PRIMARY KEY REFERENCES hanq.users(id) ON DELETE CASCADE,
 part text NOT NULL DEFAULT '' CHECK(part IN ('','1','2','3-4','5-6','7')),
 batch integer NOT NULL DEFAULT 0 CHECK(batch>=0)
);
