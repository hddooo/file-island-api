-- Additive collection projection. Keep all earlier migration checksums and ledger rows intact.
-- One first partner preserves the exact legacy balance; no new XP ledger grant is inserted.
CREATE TABLE hanq.owned_digimon (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 family text NOT NULL CHECK (family IN ('agumon','gabumon','patamon')),
 xp bigint NOT NULL DEFAULT 0 CHECK (xp>=0),
 stage integer NOT NULL CHECK(stage BETWEEN -1 AND 5),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 equipped boolean NOT NULL DEFAULT false,
 first_partner boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,family), UNIQUE(user_id,id)
);
CREATE UNIQUE INDEX owned_digimon_one_equipped ON hanq.owned_digimon(user_id) WHERE equipped;
CREATE UNIQUE INDEX owned_digimon_one_first ON hanq.owned_digimon(user_id) WHERE first_partner;
INSERT INTO hanq.owned_digimon(user_id,family,xp,stage,revision,equipped,first_partner)
SELECT u.id,'agumon',coalesce(g.points,0),coalesce(e.stage,CASE WHEN g.points>=1800 THEN 5 WHEN g.points>=1500 THEN 4 WHEN g.points>=1200 THEN 3 WHEN g.points>=1000 THEN 2 WHEN g.points>=500 THEN 1 ELSE 0 END),coalesce(e.revision,0),true,true
FROM hanq.users u LEFT JOIN (SELECT user_id,sum(amount) points FROM hanq.growth_ledger GROUP BY user_id)g ON g.user_id=u.id
LEFT JOIN hanq.partner_evolution e ON e.user_id=u.id AND e.family='agumon';
-- Old entries remain null: they are represented by the first partner's opening balance.
ALTER TABLE hanq.growth_ledger ADD COLUMN digimon_id uuid;
ALTER TABLE hanq.growth_ledger ADD CONSTRAINT growth_digimon_owner FOREIGN KEY(user_id,digimon_id) REFERENCES hanq.owned_digimon(user_id,id);
CREATE INDEX growth_digimon_history ON hanq.growth_ledger(digimon_id,created_at) WHERE digimon_id IS NOT NULL;
CREATE TABLE hanq.digimon_commands (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 request_id uuid NOT NULL,
 command text NOT NULL CHECK(command IN('claim','equip','evolve')),
 input jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,request_id)
);
CREATE TRIGGER digimon_commands_append_only BEFORE UPDATE OR DELETE ON hanq.digimon_commands FOR EACH ROW EXECUTE FUNCTION hanq.forbid_growth_mutation();
CREATE FUNCTION hanq.attribute_digimon_growth() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chosen uuid;
BEGIN
 PERFORM 1 FROM hanq.users WHERE id=NEW.user_id FOR UPDATE;
 -- New registrations already grant exactly 1000 via the existing signup ledger.
 INSERT INTO hanq.owned_digimon(user_id,family,stage,equipped,first_partner)
 SELECT NEW.user_id,'agumon',2,true,true WHERE NOT EXISTS(SELECT 1 FROM hanq.owned_digimon WHERE user_id=NEW.user_id);
 SELECT id INTO STRICT chosen FROM hanq.owned_digimon WHERE user_id=NEW.user_id AND equipped;
 IF NEW.digimon_id IS NOT NULL AND NEW.digimon_id<>chosen THEN RAISE EXCEPTION 'growth target must be equipped'; END IF;
 NEW.digimon_id=chosen;
 RETURN NEW;
END $$;
CREATE FUNCTION hanq.apply_digimon_growth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- AFTER INSERT only: a duplicate ON CONFLICT retry cannot increment XP.
 UPDATE hanq.owned_digimon SET xp=xp+NEW.amount WHERE user_id=NEW.user_id AND id=NEW.digimon_id;
 RETURN NEW;
END $$;
CREATE TRIGGER growth_attribute_digimon BEFORE INSERT ON hanq.growth_ledger FOR EACH ROW EXECUTE FUNCTION hanq.attribute_digimon_growth();
CREATE TRIGGER growth_apply_digimon AFTER INSERT ON hanq.growth_ledger FOR EACH ROW EXECUTE FUNCTION hanq.apply_digimon_growth();
CREATE FUNCTION hanq.require_equipped_digimon() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT count(*) FROM hanq.owned_digimon WHERE user_id=coalesce(NEW.user_id,OLD.user_id) AND equipped)<>1 THEN RAISE EXCEPTION 'exactly one equipped partner required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owned_digimon_equipped AFTER INSERT OR UPDATE OR DELETE ON hanq.owned_digimon DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hanq.require_equipped_digimon();
