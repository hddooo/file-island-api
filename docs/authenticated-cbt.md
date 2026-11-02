
## Batch practice and pause (migration 013)

New clients opt in with `answerMode: batch`, or upgrade a started legacy run via `POST /runs/:id/batch` while preserving existing answers/start/deadline. `POST /pause` and `/resume` are owner-locked and idempotent; pause is only permitted before expiry. Completed paused intervals extend the deadline; paused remaining time survives reload. Legacy auto-expiry behavior is unchanged.

Batch `/submit` requires a `submissionKey`, exactly 50 `{position, optionId}` entries (option may be null), and optional `currentPosition`. DTO and stored run/version/option validation precedes writes. A single transaction stores all answers, receipt/hash, grades, 50 attempts, immutable result and one growth event. Conflicting retries return 409. Batch per-answer/go endpoints refuse writes. Images are refused while paused or expired-awaiting-submission. Existing final runs and records are untouched.

Expired batch runs wait for the first complete device-frozen submission instead of prematurely grading empty answers. Late submission uses server deadline/finalReason=expired. Device choice timestamps cannot be proved without server answer writes; this is an explicit practice tradeoff. Client grading/time is not accepted.

Deploy API/migration 013 before the matching frontend. No operating migration or deployment was run as part of implementation.

## Atomic pause checkpoints (migration 014)

Pause accepts the optional backward-compatible batch DTO plus `checkpointVersion`. New clients always provide50 validated positions/options, current position and `submissionKey`. One transaction writes answers and the pause budget/receipt/revision; no attempts or growth rows are written. Same key/body retries return current state even after resume; changed bodies/stale revisions/final runs are refused. Old empty-body pause remains time-only. Migration014 only adds checkpoint fields and preserves existing results and timing constraints. Startup automatically applies it before listening; deploy API first. Owned test DB rollback validation deliberately fails the receipt increment after answer UPDATE and verifies all answer/pause changes rolled back.
