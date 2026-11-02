# Authenticated CBT (official rounds 70–79)

Signed-in members (ordinary FREE accounts included — no premium gate, payment, reward or role) take one past
한국사능력검정시험 (심화) round as a computer-based test. The server owns everything: question selection, the clock,
saved answers and grading. The browser only displays.

| Rule | Value |
| --- | --- |
| Rounds | 79 → 70 (`GET /api/v1/cbt/rounds`) |
| Questions | the round's 50 original questions, original order (number 1..50 = position 0..49) |
| Choices | the 5 original choices, original order, numbered 1..5 (no shuffling) |
| Points | original 1–3 points per question, exactly 100 per round |
| Time | 80 minutes (4 800 000 ms) from the explicit start, server clock |
| Grade | 1급 ≥ 80, 2급 ≥ 70, 3급 ≥ 60, otherwise none |

Source data: the already seeded `hanq.question_versions` (`kind = 'mock'`, current versions). A round is offered only
if it validates exactly (50 questions numbered 1..50, ids `exam-RR-NN`, options `exam-RR-NN-option-1..5`, points 1–3
summing to 100). Anything missing or unknown makes the round unavailable (`409 round_unavailable`) — nothing is invented
or filled in. Existing wrong-note runs/study sessions (20/30-minute products) are a different module and are unchanged.

## API (all routes: `Authorization: Bearer <access token>`)

The owner always comes from the token; no body contains a user id; unknown body fields are rejected (400).
Another user's run is answered exactly like a missing one (404) on every read, write and image route.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/cbt/rounds` | – | availability per round, `imagesConfigured` |
| POST | `/api/v1/cbt/runs` | `{ round: 70..79, idempotencyKey }` | creates a **ready** run. Same owner + same key → the same run (also under concurrency), `created: false`. Same key with another round → `409 idempotency_conflict`. Keys are per owner. |
| GET | `/api/v1/cbt/runs` | – | own runs, newest first (finalizes any past its deadline) |
| GET | `/api/v1/cbt/runs/:id` | – | full run view |
| POST | `/api/v1/cbt/runs/:id/start` | `{}` | ready → active, `endsAt = startedAt + 80 min`. Repeating is a no-op. |
| POST | `/api/v1/cbt/runs/:id/answer` | `{ position: 0..49, optionId: string \| null }` | save / clear one answer (`optionId` must be present) |
| POST | `/api/v1/cbt/runs/:id/go` | `{ position: 0..49 }` | save the current position (restored after reload / re-sign-in) |
| POST | `/api/v1/cbt/runs/:id/submit` | `{}` | grade now; repeating returns the stored result |
| GET | `/api/v1/cbt/runs/:id/questions/:position/image` | – | protected question image (binary WebP) |
| GET | `/api/v1/cbt/runs/:id/questions/:position/common` | – | protected shared passage image, if the question has one (else 404) |
| GET | `/api/v1/cbt/stats` | – | era/part statistics over up to 200 most recent own final runs |

Errors: `run_not_started` (409, answer/go/submit/image before start), `run_expired` / `run_final` (409, edit after
grading), `invalid_option` (400), `round_unavailable` (409), `asset_unavailable` (503).

### Deadline

Every operation on a run locks its row (`SELECT … FOR UPDATE`). If the server clock is at or after `endsAt`, the run is
first finalized (reason `expired`, `finalAt = endsAt`) with the answers saved **before** the deadline, and that grading
is committed exactly once; the late edit itself is then rejected (`409 run_expired`) and never saved. A run that is only
read/listed after its deadline is finalized the same way. Clients should show `remainingMs`/`endsAt` from the server.

### What the client sees

Before grading, each item is a strict whitelist:

```json
{ "position": 0, "questionId": "exam-79-01", "version": "…", "exam": 79, "number": 1, "points": 2,
  "options": [{ "id": "exam-79-01-option-1", "number": 1 }, …5],
  "image": "/api/v1/cbt/runs/<id>/questions/0/image",
  "common": null | { "image": "/api/v1/cbt/runs/<id>/questions/46/common", "questionNumbers": [47, 48] },
  "selectedOptionId": null, "answeredAt": null }
```

No correct answer, correct flag, review, explanation, option text or stored image path is sent before grading.
After grading (owner only), every one of the 50 items gains `review`: status (correct/wrong/unanswered), the correct
option, all 5 original options with their explanations, era, initial part label, safe study link and the original review
item. Static/public image URLs and nested source paths (`image`, `commonImage`, `imageSha256`, `src`, `path`, `url`, any
`*.webp/png/jpg` or `media/…` string, …) are stripped from everything returned.

### Result (immutable once final)

`score` (weighted by original points), `maxScore` 100, `correct`, `wrong` (answered and wrong), `unanswered`, `grade`,
`passed`, and statistics:

- **eras** — by `question_versions.era` (the raw source category). Questions with a mixed/unknown era are listed
  explicitly in `excluded` (count + positions), never guessed.
- **parts** — an *initial deterministic* label from a keyword vote over the review's decisive-answer / clue / memory
  texts only (정치 · 경제 · 사회 · 문화); ties or no evidence → `기타·분류 확인 필요`. `verified: false`: this is **not** a
  manually verified classification of the 500 questions.
- each bucket: `total`, `correct`, `wrong` (unanswered counts as wrong), `answered`, `unanswered`,
  `wrongRate = wrong / total` (`null` when total is 0). Example: 2 wrong in a 10-question part → 0.2, not 2/2.

Study links (`review.link`) are given only for era ids that exist as current study chapters; mixed eras get none.

### Attempts and wrong notes

The grading transaction writes exactly one ordinary attempt per item through `AttemptsRepository.insert`:
`source = 'run'`, `run_id = NULL` (that column belongs to the wrong-note runs), `cbt_run_id = <run>` (migration 007),
`submission_id = cbt-<runId>-<position>`, unanswered = `option_id NULL, correct = false` (the existing constraint).
Repeated submit/reads never duplicate attempts (status guard + unique submission ids). No growth-ledger or challenge
rows are written. The existing wrong notes derive from attempts, so CBT wrong/unanswered questions appear there; the
existing premium gates of wrong notes/replays/personal runs are unchanged.

Graded runs keep pointing at the exact `(question_id, version)` they showed; re-seeding a newer version never changes a
past run or its result.

## Migration 007 (`007_authenticated_cbt.sql`)

Additive only: `hanq.cbt_runs` (owner FK, unique `(user_id, idempotency_key)`, 80-minute check, status/final checks),
`hanq.cbt_run_items` (owner-consistent FK to the run, FK to the question version, 5 options, answer ∈ options), nullable
`hanq.attempts.cbt_run_id` FK, and triggers that make a final run and its items immutable. No existing row is modified.
Apply it with the normal `npm run migrate` against the intended database only when you decide to — the operating
database is not touched by this change.

## Private image volume

Original question images are **not** in Git and must not be placed in any public/static folder or copied into this
repository. Stage the canonical 500 crops on a private volume:

```
/srv/hanq-private/cbt-assets/        (example; any absolute path outside Git/public)
  70-01.webp … 79-50.webp            question images, RR-NN.webp
  72-common47-48.webp …              shared passage images, RR-commonAA-BB.webp
```

- `HANQ_CBT_ASSET_DIR=<absolute path>`; optional `HANQ_CBT_ASSET_MANIFEST=<absolute path>` with
  `{"files": {"79-01.webp": "<sha256 hex>", …}}` built from the canonical files.
- File names are derived only from the validated round/number (never from stored paths). The directory and the file are
  resolved with `realpath`; a file whose real location is not directly inside the directory (symlink escape) or that is
  not a regular WebP is refused.
- Do **not** compare the legacy `imageSha256` values of the question items: they describe older crops and differ from
  the canonical crops for some (≈55) legacy items. Use the canonical file names and, optionally, the manifest instead.
- Not configured / missing / unreadable files: start and image routes answer `503 asset_unavailable`.
  Start validates all 50 private images and common passages before setting the deadline; failure leaves the run ready.
  Startup, sign-up and unrelated features keep working. An already active run can still be submitted.
- Responses are binary `image/webp` with `Cache-Control: private, no-store` (no JSON, base64 or redirect), only for the
  owner of an active or final run.

## Tests

`npm run integration` with `HANQ_TEST_DATABASE_URL` pointing at a loopback `*_test` database
(`test/integration/cbt.test.ts`). Image fixtures are tiny WebP-shaped files written to temporary directories only.

Independent review: a start validates all 50 private images plus common materials before setting any deadline. Missing assets leave the session ready, with no attempts. Deadlines are checked after row-lock acquisition; queued late edits cannot slip through using an old request timestamp. Final sessions/items reject DELETE as well as UPDATE. Stats settle overdue sessions first.
