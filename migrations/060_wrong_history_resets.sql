-- Additive, owner/island-scoped wrong-history visibility. Never deletes attempts or alters XP.
CREATE TABLE hanq.wrong_history_resets (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 island text NOT NULL CHECK(island IN ('history','toeic')),
 reset_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,island)
);
CREATE TABLE hanq.wrong_history_reset_requests (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 request_id uuid NOT NULL,
 island text NOT NULL CHECK(island IN ('history','toeic')),
 reset_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,request_id)
);
CREATE FUNCTION hanq.wrong_history_visible(owner uuid, subject text, at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM hanq.wrong_history_resets r
  WHERE r.user_id=owner AND r.island=subject AND (at_time IS NULL OR at_time<=r.reset_at))
$$;
CREATE VIEW hanq.visible_wrong_attempts AS
 SELECT a.* FROM hanq.attempts a WHERE a.correct OR hanq.wrong_history_visible(a.user_id,'history',
 CASE WHEN a.source='import' THEN a.reported_at WHEN a.run_id IS NOT NULL THEN (SELECT created_at FROM hanq.runs r WHERE r.id=a.run_id AND r.user_id=a.user_id) WHEN a.replay_id IS NOT NULL THEN (SELECT created_at FROM hanq.replays r WHERE r.id=a.replay_id AND r.user_id=a.user_id) WHEN a.cbt_run_id IS NOT NULL THEN (SELECT created_at FROM hanq.cbt_runs r WHERE r.id=a.cbt_run_id AND r.user_id=a.user_id) ELSE a.created_at END);
CREATE VIEW hanq.visible_wrong_toeic_answers AS
 SELECT a.* FROM hanq.toeic_cbt_practice_answers a
 WHERE a.correct IS DISTINCT FROM false OR hanq.wrong_history_visible(a.user_id,'toeic',a.created_at);
CREATE VIEW hanq.visible_wrong_focus_attempts AS
 SELECT a.* FROM hanq.weakness_practice_attempts a
 WHERE a.selected_option=a.correct_option OR hanq.wrong_history_visible(a.user_id,'toeic',a.attempted_at);
CREATE VIEW hanq.visible_manual_wrong_notes AS
 SELECT a.* FROM hanq.manual_wrong_notes a WHERE hanq.wrong_history_visible(a.user_id,'history',a.added_at);
