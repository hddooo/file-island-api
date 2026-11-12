-- Site-wide presence: every signed-in HanQ tab keeps a short lease; the ice-island tab is one place among them.
-- Existing island leases keep their meaning (place='island'); nothing is dropped or rewritten.
ALTER TABLE hanq.battle_lobby_sessions ADD COLUMN place text NOT NULL DEFAULT 'island' CHECK(place IN('island','site'));
