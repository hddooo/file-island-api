-- Stable learner-facing numbers never depend on filter or source-version ordering.
CREATE TABLE hanq.toeic_cbt_display_numbers (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 source_key text NOT NULL,
 question_key text NOT NULL,
 bucket text NOT NULL CHECK(bucket IN ('lc','p56','p7')),
 display_number integer NOT NULL,
 PRIMARY KEY(user_id,source_key,question_key),
 UNIQUE(user_id,display_number),
 CHECK((bucket='lc' AND display_number BETWEEN 1 AND 4999) OR (bucket='p56' AND display_number BETWEEN 5000 AND 6999) OR (bucket='p7' AND display_number BETWEEN 7000 AND 9999))
);
CREATE TRIGGER toeic_display_number_immutable BEFORE UPDATE OR DELETE ON hanq.toeic_cbt_display_numbers FOR EACH ROW EXECUTE FUNCTION hanq.toeic_practice_immutable();
REVOKE ALL ON hanq.toeic_cbt_display_numbers FROM PUBLIC;
