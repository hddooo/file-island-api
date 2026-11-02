-- Add separate Chapter 2/3 mini banks; retain all historical attempts and owner scope.
ALTER TABLE hanq.weakness_practice_attempts
 DROP CONSTRAINT weakness_practice_attempts_bank_id_check,
 ADD CONSTRAINT weakness_practice_attempts_bank_id_check CHECK (bank_id IN
 ('vocab-mini-001-v1','vocab-mini-002-v1','vocab-mini-003-v1','focus-connectors-v4-100','focus-adj-adv-100','focus-adj-adv-v2-100','focus-connectors-v2-100','focus-connectors-v3-100','focus-ly-v2-50','focus-ly-v3-50','focus-comparison-100','focus-forms-100','focus-pronouns-100','focus-connectors-100','focus-ly-50')) NOT VALID;
ALTER TABLE hanq.weakness_practice_attempts VALIDATE CONSTRAINT weakness_practice_attempts_bank_id_check;
