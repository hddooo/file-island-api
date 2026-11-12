-- Extend accepted authored set IDs; all existing attempts and ownership remain unchanged.
ALTER TABLE hanq.weakness_practice_attempts
 DROP CONSTRAINT weakness_practice_attempts_bank_id_check,
 ADD CONSTRAINT weakness_practice_attempts_bank_id_check CHECK (bank_id IN
 ('focus-adj-adv-100','focus-comparison-100','focus-forms-100','focus-pronouns-100','focus-connectors-100','focus-ly-50')) NOT VALID;
ALTER TABLE hanq.weakness_practice_attempts VALIDATE CONSTRAINT weakness_practice_attempts_bank_id_check;
