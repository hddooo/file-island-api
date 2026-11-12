-- Append-only outcome extension; no existing battle, reward or learning row is rewritten.
ALTER TABLE hanq.battle_xp_ledger DROP CONSTRAINT battle_xp_ledger_outcome_check;
ALTER TABLE hanq.battle_xp_ledger ADD CONSTRAINT battle_xp_ledger_outcome_check CHECK(outcome IN('win','loss','void','draw'));
-- A rollback must retain draw readers and can leave this wider check in place. Never rewrite existing draw rows to void.
-- Narrowing the constraint is only valid after verifying there are no draw rows.
