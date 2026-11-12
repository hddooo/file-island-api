-- Presence belongs to a visible island tab, not the signed-in site session.
CREATE TABLE hanq.battle_lobby_sessions (
 user_id uuid NOT NULL REFERENCES hanq.users(id), session_id uuid NOT NULL,
 last_seen timestamptz NOT NULL, PRIMARY KEY(user_id,session_id)
);
CREATE INDEX battle_lobby_session_seen ON hanq.battle_lobby_sessions(last_seen);
-- Pending invitations do not reserve a player. Seats begin only on explicit acceptance.
DELETE FROM hanq.battle_seats s USING hanq.battle_matches m WHERE s.match_id=m.id AND m.status='pending';
CREATE INDEX battle_pending_inbox ON hanq.battle_matches(opponent,created_at,id) WHERE status='pending';

-- Existing practice archives remain TOEIC; new practice may use the history bank.
ALTER TABLE hanq.battle_practice_matches ADD COLUMN subject text NOT NULL DEFAULT 'toeic' CHECK(subject IN('history','toeic'));
