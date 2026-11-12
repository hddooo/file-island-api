-- New append-only authored-practice attempts. Existing records and account policy are unchanged.
CREATE TABLE hanq.weakness_practice_attempts (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 event_id uuid NOT NULL,
 bank_id text NOT NULL CHECK(bank_id IN ('focus-adj-adv-100','focus-comparison-100','focus-forms-100','focus-pronouns-100','focus-connectors-100')),
 question_id text NOT NULL,
 question_version integer NOT NULL CHECK(question_version>0),
 selected_option smallint NOT NULL CHECK(selected_option BETWEEN 0 AND 3),
 correct_option smallint NOT NULL CHECK(correct_option BETWEEN 0 AND 3),
 tags jsonb NOT NULL CHECK(jsonb_typeof(tags)='array'),
 attempted_at timestamptz(3) NOT NULL,
 received_at timestamptz(3) NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,event_id)
);
CREATE INDEX weakness_attempt_month ON hanq.weakness_practice_attempts(user_id,attempted_at);
CREATE INDEX weakness_attempt_question ON hanq.weakness_practice_attempts(user_id,bank_id,question_id,received_at DESC,event_id DESC);
CREATE INDEX weakness_attempt_history ON hanq.weakness_practice_attempts(user_id,bank_id,received_at DESC,event_id DESC);
