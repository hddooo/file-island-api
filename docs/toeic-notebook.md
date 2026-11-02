# Private TOEIC vocabulary/phrase notebook

All endpoints require the existing live JWT session guard. The owner is always `CurrentAuth.userId`; client owner fields are rejected by global whitelist validation.

- `GET /api/v1/toeic-notes` → `{notes: [...]}` ordered by last update.
- `PUT /api/v1/toeic-notes/:uuid` → `{note}`. Required fields: part (`1`, `2`, `3-4`, `5-6`, `7`), expression (1–300 chars), meaning, structure, example, confusion, sourceText, sourceReference (each string ≤6000), revision. New notes use browser-generated v4 UUID and revision 0; updates require the last returned revision.
- `POST /api/v1/toeic-notes/:targetUuid/merge` with sourceId, sourceRevision, targetRevision. Same owner only; both revisions must match. Keeps target expression/part; appends nonidentical contents and source expression/part provenance, then deletes source in the same transaction. Oversized merge rejects without changing either note.
- `409 note_conflict` prevents stale writes; `409 duplicate_expression` catches same-owner/same-part normalized duplicates. Reload and compare; never silently overwrite. Lost-response retries can return conflict, so client preserves its draft and offers a reload.

Each SQL read/write scopes user_id; composite primary key and unique key are per owner. Per-owner row lock serializes writes and merges. No premium gate, public endpoint, exam collection, seed, points, grading, or history mutation.

`019_toeic_notes.sql` is additive and creates an empty table. Existing migrator revokes PUBLIC/anon/authenticated schema/table privileges before migration commit. It has NOT been executed against production by this task. Production startup auto-applies new migrations, so deploying this API also authorizes adding this table to the single production database. API must precede frontend deployment.

Tests: `test/unit/toeic-notes.test.ts` covers owner-scoped SQL, revisions, normalization, merge provenance/overflow and validation; `toeic-notes-http.test.ts` exercises the real Nest guard, controller and validation with fake authentication/service boundaries. These are not PostgreSQL integration tests. `test/integration/toeic-notes.test.ts` passed against a disposable PostgreSQL 18.4 loopback cluster, using real migrations, authentication and HTTP/SQL flows: ownership/uniqueness, concurrent saves, merge rollback, history isolation, migration idempotency and PUBLIC privilege denial. Existing auth/quiz-progress integration suites also passed (22 tests combined), with source-blank-progress passing separately on its own empty test database (1 test). The cluster was stopped and removed after validation. No production database was used.

## Direct recall (020)

`020_toeic_recall.sql` adds owner/note-scoped progress and a per-owner Part/batch position. No seed, attempts, grading or growth data is written.

- `GET /api/v1/toeic-recall` → `{progress, view:{part,batch}}`. Returns only owned progress whose source note revision is still current.
- `PUT /api/v1/toeic-recall/:uuid` with `{noteRevision,revision,answer,revealed,evaluation}`. Answer is arbitrary text ≤6000 characters; it is never compared for correctness. `evaluation` is `''`, `known` or `review`. Reveal requires nonblank input; evaluation requires reveal. Owner is derived only from the live session.
- `PUT /api/v1/toeic-recall/view` with `{part,batch}` saves account-owned filter/batch position. Part accepts the five categories or empty for all; batch is a zero-based nonnegative integer.
- A new progress uses revision 0. Concurrent different updates produce 409; exact lost-response retries return the prior result. Source-note revision mismatch rejects. Editing a note invalidates old practice; merging invalidates target revision and cascades deleted-source progress through the composite owner/note FK.

Browser batching is stable by source creation time/UUID with maximum 100 rows and no padding. The meaning and explanation are inserted into the practice DOM only after an entered answer is revealed. These are self-reported memory checks, not semantic/exact-match scoring.

## Approved notebook-only display refinement

Migration022 adds translation, part_of_speech and up to3 contextual synonyms, plus unclassified Part for genuinely unknown sources. Existing records and omitted optional fields are preserved. This strict release contains019/020/022; it does not contain CBT021 or the TOEIC CBT module. Labels never claim an official TOEIC frequency ranking.
