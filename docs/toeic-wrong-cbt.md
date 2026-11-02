# Private TOEIC wrong-question replay

This is separate from the Korean history CBT and the TOEIC vocabulary/phrase notebook. It reuses the existing live-session guard, owner-first transaction lock, validation/filter and idempotent checkpoint/submission patterns; it does not generalize or rewrite the history engine.

## Source and readiness

`toeic_cbt_collections` is a private, owner-bound, immutable source version. No shared seed, startup import, public upload or HTTP source-writing endpoint exists. `prepareToeicCollection` prepares a bundle without binding an account or writing a DB. `storePrivateToeicCollection` is an internal explicit-owner storage helper; invoking it with real user material requires the separate account verification/import authorization. It is used only with synthetic sources in these tests.

A source lists the user's exact wrong question numbers and separate audio/passage groups. Sibling context questions do not become wrong questions. A valid group can include 35–37 while only37 is in questions/wrongNumbers; 38–40 stays a different group. Unicode asset URL strings are validated but retained exactly; no normalization is performed.

Every target must have the correct number/group, verified original question, required choice count (Part2 A–C, others A–D), explicit verified answer key, and required verified audio (LC) / photo (Part1) / passage (Part6/7). Missing material prevents create/start/checkpoint/submit. ASR, removed warning markers, plausible inferred answers and successful HTTP HEAD do not set verification flags. HTTPS asset URLs have no credentials or fragment; the server does not fetch arbitrary source URLs.

The current real 22-item private bundle remains account-unbound and ungradeable. Its source, choices/keys/Part1 photo are not fabricated or runtime seeded. Its 21 derived remote audio URLs and all real-audio browser playback remain unverified; one URL has audio-thread reported checks only. Synthetic data lives only in `test/helpers/toeic-fixture.ts` and is imported by tests, never by runtime/seeding.

## API (all require JwtAuthGuard)

- GET `/api/v1/toeic-cbt/collections`: latest private source versions by source key, readiness/missing-material summaries only. No choices, scripts or answers.
- GET `/api/v1/toeic-cbt/runs`: caller's latest100 per-round attempts.
- POST `/runs`: `{collectionId,idempotencyKey}`. Creates a ready attempt only for a complete owned source. Equal retries return the same attempt.
- GET `/runs/:id`: owned run. Ready/paused responses have no items; active responses omit scripts, explanations and correct answers. Part1/2 show letter choices only; their spoken choices/question text are disclosed after grading.
- POST `/runs/:id/start`: start an untimed wrong-question practice. No history80-minute/50-question/score rules are applied.
- PUT `/runs/:id/checkpoint`: `{revision,cursor,paused,answers:[{position,optionId}]}`. Whole ordered snapshot, null for unanswered. Same snapshot retry is harmless; stale different snapshots409. Owner then run lock serializes races.
- POST `/runs/:id/resume`: `{revision}`.
- POST `/runs/:id/submit`: `{revision,cursor,submissionKey,answers}`. Revalidates source, owner and every option, grades only against verified source keys, records correct/wrong/unanswered counts. Equal final retries return the immutable result; conflicting retries409.

Correctness here is multiple-choice grading from a verified key, distinct from the wordbook's self-assessment. TOEIC attempts never touch history questions/attempts/CBT results/growth or vocabulary progress. Each replay is a new run; previous source versions/final runs/items cannot be rewritten. Explanations/scripts are shown only after grading; missing explanation is explicitly pending, ASR script is labelled unverified.

## Tests and deployment

`test/unit/toeic-cbt.test.ts`: readiness fail-closed, source import verification flags and DTO bounds. `test/integration/toeic-cbt.test.ts`: real temporary PostgreSQL/auth/HTTP, incomplete rejection, owner isolation, create/checkpoint/submit races/retries, pause/relogin, final/source immutability and separation from history/vocabulary.

`../front/scripts/qa-toeic-cbt-postgres.cjs`: actual browser → local API → disposable PostgreSQL, with intercepted synthetic image/WAV only, at390/1440px. Never run against production; existing helpers reject non-loopback/non-*_test DBs.

Migration021 is additive (three tables and immutability triggers). Not applied to production. It must deploy with the API before the frontend; actual owner binding/import and operating deployment remain separately unapproved.

## Paper-exam preparation

`replayNumbers` expands the exact printed group membership for Parts3/4/6/7. `wrongNumbers` remains the original mistakes; sibling questions are marked separately. Create accepts optional unique integer `parts` (1–7); only that selected material must be ready, so a verified RC part may run while LC is pending. Immutable run items define the selected question set across pause/reload/grading. Reusing a creation key for another part returns409.

Photo/diagram sources may use `private-image:<sha256>`. Migration025 adds owner+collection-bound image bytes (8MiB limit) with no PUBLIC privileges. GET `/collections/:id/images/:key` reuses the live JWT guard, checks the owner and returns `private, no-store`; the client obtains an authenticated image blob and revokes its object URL on navigation. Do not place original paper images or import JSON in the frontend repository. Existing authorized HTTPS audio URLs are unchanged.

PendingManifest groups now accept `passage`, `passageVerified`, `scriptVerified`. Every question still requires verified original choices and keys. The source-review package and verified asset bytes are required before real import. No real data import or production deployment is claimed by the implementation tests.

User scope clarification: RC101–108,135–138,143–150,153–154 are intentionally omitted correct ranges, not missing material. Do not request them or show an incomplete warning. Keep122 replay questions and57 original mistakes distinct. Only a genuinely cut-off required passage/choice in an included group blocks readiness; none is currently identified.

## Structured tutoring explanations (local, deployment pending)

Questions optionally include `tutorExplanation`: `{answerReason, reading:[{chunk,translation}], steps:[string], options:[{id,explanation}], traps:[string], checklist:[string]}`. Every choice needs its own rationale. This supplements the existing explanation text; original questions, answer keys and original-wrong flags stay unchanged. Catalog validation rejects malformed optional tutoring data. The collection list and active run do not expose any tutoring fields. Only an owned final run returns it under `review.tutorExplanation`.

The final-review UI shows the core answer reason immediately. A native keyboard-accessible details panel separates reading/translation, reasoning steps, choices, traps and the next-question checklist. Long legacy explanations remain available in a collapsed full-text panel. All teaching text uses textContent.

## Repeated practice numbering and unverified proposals

`sourceIdentity` optionally preserves `{key,unit,page,questionNumber}` independently of the internal numeric item number. Unknown Unit remains null. Keys must be unique within a collection; repeated printed numbers on distinct source pages remain distinct, and the UI displays the page plus original printed number. Practice collections can omit cumulative book-round metadata.

`answerStatus: assistant_inferred_not_officially_verified` preserves an independent proposed answer. It always blocks grading readiness as `official_answer_key`, even if an erroneous import flag sets answerVerified=true. It must never be silently promoted from a photo tick or confidence score. Full original source payload and observed marks are preserved in the local preparation package; an uncertain marked choice is not a confirmed original answer.

## Recovery completion

Cumulative mistake counts are computed from immutable final run items, grouped by source key and stable question identity. An imported original mistake contributes once across source versions. Sibling questions start at zero; correct replays do not clear prior mistakes; idempotent submit retries reuse the same final run. Two verified mistakes display a repeat badge.

Optional `checkQuestions` are authored practice, separately labelled from publisher questions and disclosed with the post-submit tutor explanation. ETS proposed-answer collections remain grading-disabled. Their owner can use `GET /collections/:id/study` to read the original questions and explicitly unofficial explanations without creating a graded run or changing mistake counts. The route rejects other owners and verified exam collections.

## Deployment verification records

Migration026 stores owner-bound annotations separately from immutable runs and items. Annotated checks are labelled `verification: true` in run summaries, shown as deployment checks in history, and excluded from cumulative mistake queries. They cannot start, resume, checkpoint or submit as real study; the owner starts a new regular run. Annotating a check never rewrites or deletes its original answers/results. The two operational checks are annotated by explicit owner-verified, idempotent operational INSERT, with no public write route.
