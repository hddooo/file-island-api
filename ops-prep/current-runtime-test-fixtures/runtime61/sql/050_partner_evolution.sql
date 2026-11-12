-- Additive manual evolution state. Existing XP, battle snapshots and learning ledgers are untouched.
CREATE TABLE hanq.partner_evolution (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 family text NOT NULL CHECK(family IN ('agumon','patamon')),
 stage integer NOT NULL CHECK(stage BETWEEN 0 AND 5),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 initialized_points bigint NOT NULL,
 initialized_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,family),
 CHECK(family<>'patamon' OR stage<=3)
);
CREATE TABLE hanq.partner_evolution_events (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 request_id uuid NOT NULL,
 family text NOT NULL CHECK(family IN ('agumon','patamon')),
 from_stage integer NOT NULL,
 to_stage integer NOT NULL,
 revision integer NOT NULL,
 points bigint NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,request_id),
 UNIQUE(user_id,family,revision),
 CHECK(to_stage=from_stage+1)
);
-- Preserve both existing selectable chains at their introduction-time XP stage.
INSERT INTO hanq.partner_evolution(user_id,family,stage,initialized_points,initialized_at,updated_at)
SELECT u.id,f.family,CASE WHEN f.family='patamon' THEN
 CASE WHEN p.points>=1800 THEN 3 WHEN p.points>=1500 THEN 2 WHEN p.points>=1200 THEN 1 ELSE 0 END
 ELSE CASE WHEN p.points>=1800 THEN 5 WHEN p.points>=1500 THEN 4 WHEN p.points>=1200 THEN 3 WHEN p.points>=1000 THEN 2 WHEN p.points>=500 THEN 1 ELSE 0 END END,
 p.points,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM hanq.users u CROSS JOIN (VALUES('agumon'),('patamon')) f(family)
CROSS JOIN LATERAL (SELECT greatest(coalesce(sum(amount),0),0)::bigint points FROM hanq.growth_ledger WHERE user_id=u.id) p;
CREATE TRIGGER partner_evolution_events_append_only BEFORE UPDATE OR DELETE ON hanq.partner_evolution_events FOR EACH ROW EXECUTE FUNCTION hanq.forbid_growth_mutation();
