-- Additive shop and timed egg state. Keep all existing XP/account/battle ledgers intact.
-- Roll back application code only to a version that understands timed eggs; retain these
-- tables/columns and receipts. Never down-migrate ownership or reset hatch timestamps.
CREATE TABLE hanq.shop_products (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('egg','clothing','skin')),
 family text UNIQUE CHECK(family IN('agumon','gabumon','patamon')),
 name text NOT NULL,
 price_coin bigint NOT NULL DEFAULT 0 CHECK(price_coin=0),
 active boolean NOT NULL DEFAULT true,
 UNIQUE(id,family),
 CHECK((kind='egg' AND family IS NOT NULL) OR (kind<>'egg' AND family IS NULL))
);
INSERT INTO hanq.shop_products(id,kind,family,name) VALUES
 ('egg-gabumon','egg','gabumon','파피몬 알'),('egg-patamon','egg','patamon','파닥몬 알');
-- Coin is a separate game balance. There are no issuance/payment endpoints in this release.
CREATE TABLE hanq.coin_accounts (
 user_id uuid PRIMARY KEY REFERENCES hanq.users(id),
 balance bigint NOT NULL DEFAULT 0 CHECK(balance>=0)
);
ALTER TABLE hanq.owned_digimon ADD COLUMN product_id text;
ALTER TABLE hanq.owned_digimon ADD CONSTRAINT owned_product_family FOREIGN KEY(product_id,family) REFERENCES hanq.shop_products(id,family);
ALTER TABLE hanq.owned_digimon ADD COLUMN hatch_started_at timestamptz;
ALTER TABLE hanq.owned_digimon ADD COLUMN hatch_ready_at timestamptz;
ALTER TABLE hanq.owned_digimon ADD COLUMN hatched_at timestamptz;
ALTER TABLE hanq.owned_digimon ADD CONSTRAINT owned_product_once UNIQUE(user_id,product_id);
ALTER TABLE hanq.owned_digimon ADD CONSTRAINT owned_hatch_times CHECK(
 (hatch_started_at IS NULL AND hatch_ready_at IS NULL AND hatched_at IS NULL) OR
 (hatch_started_at IS NOT NULL AND hatch_ready_at IS NOT NULL AND hatch_ready_at=hatch_started_at+interval '60 seconds'
  AND (hatched_at IS NULL OR (hatched_at=hatch_ready_at AND stage>=0)))
);
-- Existing claimed eggs retain ownership/XP. An already selected egg starts now once.
UPDATE hanq.owned_digimon d SET product_id=p.id FROM hanq.shop_products p WHERE d.family=p.family;
UPDATE hanq.owned_digimon SET hatch_started_at=CURRENT_TIMESTAMP,
 hatch_ready_at=CURRENT_TIMESTAMP+interval '60 seconds',revision=revision+1
 WHERE stage=-1 AND equipped;
CREATE INDEX owned_hatch_due ON hanq.owned_digimon(user_id,hatch_ready_at) WHERE stage=-1;
