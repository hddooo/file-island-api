-- Existing audit rows and historical growth entries remain unchanged.
ALTER TABLE hanq.admin_xp_adjustments ADD COLUMN digimon_id uuid;
ALTER TABLE hanq.admin_xp_adjustments ADD COLUMN digimon_balance_before bigint;
ALTER TABLE hanq.admin_xp_adjustments ADD COLUMN digimon_balance_after bigint;
ALTER TABLE hanq.admin_xp_adjustments ADD CONSTRAINT admin_xp_digimon_owner
 FOREIGN KEY (user_id,digimon_id) REFERENCES hanq.owned_digimon(user_id,id);
ALTER TABLE hanq.admin_xp_adjustments ADD CONSTRAINT admin_xp_digimon_balances CHECK (
 (digimon_id IS NULL AND digimon_balance_before IS NULL AND digimon_balance_after IS NULL)
 OR (digimon_id IS NOT NULL AND digimon_balance_before IS NOT NULL AND digimon_balance_after IS NOT NULL
     AND digimon_balance_before>=0 AND digimon_balance_after>=0
     AND digimon_balance_after=digimon_balance_before+applied_delta)
);

-- Explicit targeting is restricted to a matching immutable administrator audit row.
-- All ordinary rewards and legacy administrator calls still follow the equipped partner.
CREATE OR REPLACE FUNCTION hanq.attribute_digimon_growth() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chosen uuid;
BEGIN
 PERFORM 1 FROM hanq.users WHERE id=NEW.user_id FOR UPDATE;
 INSERT INTO hanq.owned_digimon(user_id,family,stage,equipped,first_partner)
 SELECT NEW.user_id,'agumon',2,true,true WHERE NOT EXISTS(SELECT 1 FROM hanq.owned_digimon WHERE user_id=NEW.user_id);
 IF NEW.digimon_id IS NOT NULL AND NEW.kind='admin-adjustment' AND NEW.admin_adjustment_id IS NOT NULL THEN
  PERFORM 1 FROM hanq.admin_xp_adjustments a WHERE a.id=NEW.admin_adjustment_id AND a.user_id=NEW.user_id
   AND a.digimon_id=NEW.digimon_id AND a.applied_delta=NEW.amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'growth target requires matching admin adjustment'; END IF;
  RETURN NEW;
 END IF;
 SELECT id INTO STRICT chosen FROM hanq.owned_digimon WHERE user_id=NEW.user_id AND equipped;
 IF NEW.digimon_id IS NOT NULL AND NEW.digimon_id<>chosen THEN RAISE EXCEPTION 'growth target must be equipped'; END IF;
 NEW.digimon_id=chosen;
 RETURN NEW;
END $$;
