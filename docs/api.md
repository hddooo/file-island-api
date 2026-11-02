# HanQ API v1

Base path `/api/v1`. JSON only (≤ 256 KB). Errors: `{ "error": { "code", "message", "details?" } }`.
Auth: `Authorization: Bearer <access token>` (10 min). The refresh token is an HttpOnly cookie `hanq_rt` (path `/api/v1/auth`).
Cookie routes (signup, signin, refresh, logout) also require an allow-listed `Origin` and `X-HanQ-CSRF: 1`.
Unknown body fields are rejected (400). Someone else's object id answers 404, exactly like a missing one.

## Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/signup` | `{email, password, displayName?}` → 201 `{accessToken, accessTokenExpiresAt, tokenType, user}` + cookie. 409 `email_taken`, 400 `weak_password`/`invalid_email`. |
| POST | `/auth/signin` | `{email, password}` → 200 same shape. 401 `invalid_credentials` (same for unknown e-mail), 429 `too_many_failed_signins`, 429 `rate_limited`. |
| POST | `/auth/refresh` | cookie → 200 new access token + rotated cookie. 401 `invalid_refresh`; 401 `refresh_reused` (family revoked). |
| POST | `/auth/logout` | revokes the cookie's session (and the bearer's, if sent) → 204, cookie cleared. |
| POST | `/auth/logout-all` | bearer → revokes all sessions `{revokedSessions}`. |

## Profile
| GET | `/me` | `{user:{id,email,displayName,createdAt}, premium:{active,expiresAt,serverTime}}` |
| PATCH | `/me` | `{displayName}` only. |
| POST | `/me/password` | `{currentPassword, newPassword}` → revokes other sessions. 403 `wrong_current_password`; 409 `password_changed` (another change won the race); 401 if this session was revoked meanwhile. |
| GET | `/me/growth-history?cursor=&limit=` | Read-only growth-point history of the token's own user (append-only `growth_ledger`, migration 003). Newest first by `(created_at, event_key)` with a strict keyset; `limit` 1–50 (default 20). `{items:[{reason, points (signed int), createdAt, examResult?}], next}` — `examResult` is present only on `wrong-note-study` / `cbt-exam` rows: `{score, maxScore:100, correct, total}` read from the result the server stored when it graded that run (`runs.score.examScore`/`questions`/`correct` · `cbt_runs.result.score`/`correct`/`total`), via read-only LEFT JOINs on the ledger's own `run_id` / `cbt_run_id` restricted to the same owner and a `final` run; it is `null` when the run is unfinished, the stored result predates `examScore`, or any stored field disagrees with the others or with the ledger amount (never a guessed score) — `next` is an opaque base64url cursor carrying the microsecond UTC timestamp + ledger key (ties and µs-apart rows are never skipped or repeated); malformed/non-canonical cursor → 400 `invalid_cursor`. No ledger keys, run ids, answers or user ids in the DTO. **No migration, grant or backfill** (the API role already reads `growth_ledger` for `GET /me`). Needs an API deploy (separately approved). |

## Questions (public)
| GET | `/questions?kind=quiz|mock&era=&after=&limit=` | current versions, `{items:[{questionId,version,kind,current,points,item}], next}`; `item` has no answer/explanation. |
| GET | `/questions/:id` | current version of one question. |

## Attempts (signed in, free)
| POST | `/quiz/progress` | Read-only exact scope: `{questions:[{questionId,version}]}` (1–1000 unique quiz IDs, current versions). Ordered `{items:[{questionId,version,answered,optionId,correct,answeredAt}], total, answered}`. Only this member’s non-null submitted answers count, right or wrong; no writes/premium gate. Unanswered run items do not count. Stale/unknown/non-quiz → 409; duplicate IDs → 400. |
| POST | `/attempts` | `{submissionId, questionId, version, optionId}` → 201 `{attempt, replayed, review}`. Server grades. Same submissionId + same payload → original (`replayed:true`); different payload → 409 `submission_conflict`. Non-current version → 409 `stale_version`; unknown → 404; foreign option → 400 `invalid_option`. |
| GET | `/attempts?cursor=&limit=` | newest first, `{items, next}`. |
| GET | `/attempts/:id` | own attempt + review. |
| POST | `/imports/local-attempts` | `{importKey, entries:[{localId, mode, questionId, contentVersion, optionId|null, ts?}] ≤500}` → `{received, imported, alreadyImported, skipped:[{localId,reason}], skippedCount, grantsPremium:false}`. Key bound to the first account (409 `import_key_owned_by_another_account`). Optional `scope:'account'` (automatic per-account sync from the front): the stored submission id is `imp-` + sha256(`hanq-import-account|<userId>|<localId>`)[0..40] — independent of the import key, so the same local record sent under two keys of one owner (two tabs) is stored once; without `scope` the original `keyHash|localId` ids are kept (legacy same-key retries still replay). The ≤5000 cap per key counts **accepted unique rows** (`import_batches.accepted`), not payloads received: resends are acknowledged (`alreadyImported`) without being charged, and at the cap only genuinely new entries are skipped with reason `import-cap-reached` (no request-level 409 any more; `received` stays informational). Imports never grant premium or growth points. `GET /attempts` items carry the exact `submissionId` so the owner can reconcile. Needs an API deploy; no migration. |

## Wrong notes
| GET | `/wrong-notes?status=unresolved|all&kind=&era=` | free; `{counts:{unresolved,resolved,everWrong,stale}, items, stale}` |
| POST | `/wrong-notes/replays` | **premium**. `{list:'unresolved'|'all', order:'recent'|'random', kind?, era?, size?≤100}` → finite server queue. |
| GET | `/wrong-notes/replays`, `/wrong-notes/replays/:id` | own replays; answered positions include result + review. |
| POST | `/wrong-notes/replays/:id/answers` | **premium** for new answers. `{submissionId, position, optionId}`. 409 `already_answered`. |

## Runs (personal wrong-based practice, premium)
| POST | `/runs` | `{product:'personal-mini'(20 q, 30 min)|'personal-formal'(50 q, 80 min), scope, order}`; needs ≥10 distinct wrong questions (409 `not_enough_wrongs`), fills from rounds 79→70. |
| GET | `/runs`, `/runs/:id` | own runs. Reading a run past its deadline grades it (`finalReason:'expired'`). |
| POST | `/runs/:id/start` | sets `startedAt`, `endsAt` (server clock). |
| PUT | `/runs/:id/answers/:position` | `{optionId|null}`; 409 `run_expired` / `run_final` / `run_not_started`. |
| POST | `/runs/:id/submit` | grades once; repeated submit returns the same result. Answers/review appear only when final. |

## Premium & payments
| GET | `/premium/plan` | public: plan (5,000 KRW, renewal none, period policy) + `checkout:{available, provider, testMode}` |
| GET | `/premium` | `{active, expiresAt, serverTime, plan, grants[]}` |
| POST | `/payments/orders` | `{planId:'premium-1m'}` → 201 pending order (amount/currency set by server). 503 `payment_provider_unavailable` when no provider. |
| GET | `/payments/orders`, `/payments/orders/:id` | own orders. |
| POST | `/payments/orders/:id/confirm` | `{paymentKey?, testOutcome?}` → 200 `{order, alreadyPaid, grant}`. 402 `payment_declined`, 409 `payment_mismatch`/`payment_reused`/`order_closed`. |
| POST | `/payments/webhooks/:provider` | 503 until a real provider adapter exists. |

`GET /health` → `{status:'ok'}` or 503.

## Growth rewards (existing migrations 008 / 009)
- **Ordinary practice (008)** — `POST /attempts` (source `practice`, free and premium members, existing free-5 / premium access gate unchanged): the server grades from the stored answer and, in the SAME transaction, writes one `growth_ledger` row per newly recorded attempt: quiz correct +1 / wrong −1, past-exam mock correct +5 / wrong −5 (`kind` `practice-quiz` / `practice-mock`, `event_key 'practice:<attempt id>'`, unique `attempt_id`). Response adds `growth:{delta, points}` (points = authoritative total). Replaying the same `submissionId` returns the original attempt and delta with no second row; a different payload under it is 409 `submission_conflict`; a new `submissionId` is a new grade and a new reward. Imports, wrong-note replays/study and CBT never get practice rewards; no backfill. If 008 is missing the insert fails and the whole grade rolls back (503 `schema_not_ready`).
- **CBT final score (009)** — once per final run, in the finalization transaction (submit, deadline expiry, listing, concurrent submits all finalize once): original weighted score (no normalization) <60 −100 · 60–69 +50 · 70–79 +100 · 80–89 +150 · ≥90 +200 (`kind` `cbt-exam`, `event_key 'cbt:<run id>'`, unique `cbt_run_id`); `result.growthReward` is stored in the immutable result. Never per question. Runs finalized before 009 get nothing.
- **Schema prerequisite**: 008 depends on 001/003; 009 requires 007/008. The previously approved 007–009 application was verified in this session. Final-score history joins use these existing columns and add no migration, grant or backfill. The 24-hour review policy (e27b81c7) also needs no new migration: it uses existing attempts and question_review_state. This change does not apply migrations or modify operating data.
- `/me/growth-history` reasons now include `practice-quiz`, `practice-mock`, `cbt-exam`.
