# 81st edition Joseon/Goryeo quiz workspaces

Implementation candidate; not yet deployed. Opening is excluded and its existing transport remains unchanged.

Base: `/api/v1/textbook/revisions/d54c1aa5d5816eeb73a2e82da0ec699555c2cbf1e7cb717a3b84420ed18296de/semantic`.

- `GET /quizzes/{joseon|goryeo}`: `hanq-source-quiz/1`, derived only from the existing byte-pinned private Script bundle; original printed answers retained. Includes `version` and `scriptResponseGroups` linking existing Script field IDs to ordered quiz slot IDs. Do not guess IDs from display numbering.
- `GET /workspaces/{joseon|goryeo}`: `{version,revision,workspace:{cursor,status,responses},updatedAt}`. An untouched workspace has revision 0, cursor 0, active status and empty responses.
- `PUT /workspaces/{joseon|goryeo}`: `{version,revision,mutationId,cursor,status,updates:[{itemId,values,submitted,checkedSlots?}]}`. Same bounded batch contract as 79. Server recalculates submitted/correct state; it never accepts client grades. `values` follow `sourceSlots(item)` order. Empty updates can save cursor/pause. UUIDv4 mutation IDs support immediate retry; stale revisions or reused mutation IDs with different payload return 409. Refetch and reconcile before retrying conflicts.

JWT/live-session and existing textbook member checks apply to every route. Private/no-store, nosniff, same-site headers apply before guards. No anonymous fallback. Unsupported revision/era is 404 after authentication; missing or corrupt pinned data is 503. No filesystem paths are accepted from callers. Abort fetches on route/account/logout changes; an aborted PUT may already have committed, so retry the same mutation ID/payload or refetch rather than assuming it was cancelled.

Database uses the existing `source_blank_workspaces` table, with account from authenticated context and quiz key `history:81-2026:{era}:{rawScriptSha256}`. Version binds schema, source and derived items. No schema migration, legacy progress import, deletion or writes to 79 keys. Different account, era and edition remain isolated.

## Checked-question review selection

GET/PUT responses always include `workspace.selectedReviewQuestionIds: string[]`; older rows and untouched workspaces return `[]` without a database write. This is a user's review selection, independent of graded `checkedSlots` and answer correctness. Source versions, item IDs and quiz JSON remain unchanged.

Every GET/PUT response also includes top-level `reviewSelectionAvailable: true`. FE must require this explicit flag to enable persistence; array presence alone is insufficient because an older API after rollback may return the stored JSON array while rejecting the new PUT field. Missing/false capability means unsupported. This contract uses a full replacement array, not individual `{itemId, boolean}` patch actions; FE can collect `reviewMarks.set()` changes into that array under the existing CAS/recovery queue.

The existing PUT batch accepts optional top-level `selectedReviewQuestionIds`. Omission preserves the saved selection (including requests from older clients); a supplied array replaces the selection atomically with any answer updates. `[]` explicitly unchecks all questions. `null`, nonarrays, duplicates, other-era/unknown IDs and lists exceeding the loaded quiz item count return400 `invalid_source_progress` without saving. Only exact `quiz.items[].id` values are accepted, at most172 for Joseon or100 for Goryeo. Input order is retained; FE can render selected questions in quiz order.

To save selection only, send the normal version/revision/UUIDv4 mutationId/cursor/status fields with `updates: []` and the full selected ID list. Answers, checked-slot masks and grades are preserved; cursor/status retain their normal batch semantics. Existing optimistic revision conflict and idempotency rules cover the selection too. After409 refetch and reconcile selections before resending. Reusing a mutationId with a changed list is a conflict. A cancelled PUT may already have committed; refetch or retry exactly. No new endpoint, migration or permission is introduced. Persistent selection must remain gated in FE until this additive API release is verified deployed.

Joseon: 172 items / 172 Script response groups. Goryeo: 100 items / 103 Script response groups / 104 physical answer slots. Its one printed two-part blank remains ordered; the four classification subresponses remain in printed order. FE must use the explicit group-to-slot mapping, not collapse 104 slots to 103. Source bytes and printed answer punctuation are retained separately from whitespace-normalized rendering. No invented answer synonyms.

FE integration: keep the reviewed Script reader and field IDs, fetch the matching quiz and workspace under the same authenticated session, use 79 renderer/grade and save/recovery behavior, and batch changed item responses. Review filters derive from server-confirmed `submitted && correct === false`. Never label temporary drafts as saved. The new revision endpoints do not activate any other revision routes or replace old semantic APIs.

Release plan: derive locally from the currently deployed Opening image, copy only new compiled workspace/projection files and the changed textbook module. Preserve all existing Script sources, mounts, bootstrap, network, credentials and Compose overrides. No private image registry push. Rollback must restore the current Opening image and all Joseon/Goryeo/Opening overrides, not invoke earlier era-only rollback scripts. Runtime verification and real-member/CI limitations will be recorded separately.

## Local evidence

Both actual byte-pinned bundles pass the existing FE `hanq-source-quiz/1` validator. All 276 physical answer slots pass both client and server grading; all 272 items complete through the existing batch reducer. The mapping contains byte ranges, hashes and identifiers only, with seven distinct Joseon printed-number groups and eight Goryeo groups. Original text/answer strings are read from the existing private mounts at request time. The temporary Joseon paragraph field keys are mapped explicitly, while persistent IDs include the original segment, printed group and question number.

Six synthetic unit/HTTP cases cover immutable projection, ordered split answers, account/era isolation, no legacy imports, completion/draft correction, invalid mutations, idempotent retries, conflicts, DTO rejection and live-session rejection boundaries. The HTTP test stubs the authentication result; existing transport tests exercise actual token/session code. A separate empty, network-disabled PostgreSQL fixture verifies competing first inserts (one success/one conflict), idempotent retry, unchanged legacy79 row, account/era isolation and pause/resume across service instances. It never uses production credentials or records.

The model carries the 81 PDF SHA in `source.sha256` and the raw MD SHA separately in `source.scriptSha256`. FE must pass the explicit revision to all client methods and recovery keys. API response `version` is authoritative; never hard-code a version from an earlier local draft. Printed explanatory parentheticals remain part of single answers; this change does not invent aliases or silently correct the textbook.
