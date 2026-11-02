# Security boundaries

## Data placement and database privileges
- Everything is in schema **`hanq`** (sibling of `public`/`auth`/`storage`). Nothing is created in `public`; no other schema
  or role is modified. `migrations/repeatable/privileges.sql` revokes all privileges (and per-schema default privileges)
  on `hanq` objects from `PUBLIC` and — if they exist — Supabase's `anon` and `authenticated` roles.
- Timing: the migrator runs that file right after `CREATE SCHEMA IF NOT EXISTS hanq` (before any table exists — closes a
  pre-existing schema that had PUBLIC usage), **inside every migration transaction before COMMIT** (new auth/answer tables
  are never visible to other sessions with broader rights), and once more at the end. The integration test starts from a
  hand-made `hanq` with PUBLIC usage/create and a PUBLIC default SELECT grant and proves all of it is gone.
- Do **not** add `hanq` to Supabase's exposed Data API schemas. The browser never talks to the database and never uses the
  anon/service keys; only this API connects.
- Recommended roles (create them yourself; nothing here creates or alters roles on the real database):
  - `hanq_owner` (NOLOGIN, owns schema `hanq`) — used only to run migrations (`SET ROLE` or a dedicated login for CI).
  - `hanq_app` (LOGIN) — runtime role: `GRANT USAGE ON SCHEMA hanq`, `SELECT, INSERT, UPDATE` on tables,
    `DELETE` only on `hanq.auth_login_failures`, `USAGE` on identity sequences. No `CREATE`, no superuser/BYPASSRLS.
    The entitlement ledger is append-only by trigger regardless of role. Re-grant after adding tables in new migrations.
  - Do not use the `postgres`/service role for the running API in production.
- TLS: `verify-full` with `rejectUnauthorized: true` and hostname verification. CA: `HANQ_DB_CA_FILE` if set; otherwise for
  Supabase hosts the bundled public CA `certs/supabase-prod-ca-2021.crt`, accepted only when its SHA-256 equals the pin
  (`npm run ca:supabase` re-downloads and re-checks it). Node's global trust store is never modified. Disabling TLS is only
  possible for a loopback database outside production. URL parameters (including JDBC query fields) cannot weaken this.
  Connection strings — including a JDBC `DATABASE_URL` whose credentials are decoded in memory — are never logged, echoed
  or written anywhere.

## Authentication
- Current retention policy: ordinary access source default is 7 days (configurable within the existing bounds). Opt-in `remember-90d` is accepted only when the existing feature setting enables it. See `src/auth/retention-policy.ts` and `src/config/config.ts`; this documentation does not change runtime settings.
- Passwords: 10–128 chars, Argon2id (m=19 MiB, t=2, p=1). Unknown e-mails spend the same hashing time. Plaintext is never
  stored or logged. E-mail uniqueness on the NFKC-lowercased address.
- Access JWT: HS256, `typ: at+jwt`, `aud: hanq-api`, issuer checked, carries the session-family id; every request
  re-checks that the family exists, belongs to the subject, is not revoked and not expired (logout is immediate).
- Refresh JWT: separate secret, `typ: rt+jwt`, `aud: hanq-refresh`, random 256-bit jti stored only as SHA-256.
  Rotation happens inside one transaction with row locks; presenting an already-used token revokes the whole family.
  Legacy family defaults to 30 days. Opt-in remember mode has an absolute 90-day family deadline and at most 15-minute access JWTs; refresh does not slide the family deadline.
- Refresh cookie: HttpOnly, Path `/api/v1/auth`, SameSite per config, Secure forced in production. Cookie routes require
  an allow-listed `Origin` **and** `X-HanQ-CSRF: 1` (non-simple header → CORS preflight only granted to allowed origins).
  Prefer an API host that is same-site with the front; cross-site cookies need `SameSite=None; Secure` and may be blocked
  by browsers.
- Races: sign-in and password change verify the (slow) hash without locks, then lock the user row and require the stored
  hash to be the one they verified before acting. Sign-in therefore never creates a session after a concurrent password
  change committed; of two concurrent changes with the same old password exactly one wins (`409 password_changed`); a
  password change also needs its own session to still be live (locked after the user row). Lock order is always
  user row → session family. Covered by deterministic row-lock-barrier tests (`test/integration/concurrency.test.ts`).
- Rate limits: per-IP general limit and stricter credential-route limit (in-memory per instance), plus a per-account
  failed-sign-in window stored in PostgreSQL (shared by instances).

## Authorization
- The subject always comes from the verified access token; request bodies cannot carry user ids (unknown fields → 400).
- Every owned object query includes `user_id = <subject>`; foreign ids are indistinguishable from missing ones (404).
- Premium is decided only by `hanq.premium_state.expires_at` (`now < expiresAt`) inside the same transaction as the action.
  The browser's view of premium is display-only.

## Questions and grading
- Pre-grade responses use an explicit allow-list of question fields (no `answer`, `a`, `compound`, option `correct`,
  reviews, explanations or answer-bearing source records). The full original item is returned only after the caller's own
  graded submission. Note: the public static front still ships its own complete catalogs for the offline app — the server
  protects grading authority and premium features, not secrecy of the free practice answers.
- Correctness is always computed from the stored correct option of the exact question version.

## Payments
- Amount, currency and owner come from the server's order. A provider adapter must verify server-to-server; the service
  then checks amount, currency and order reference under the order row lock. One provider payment id → one order
  (unique), one payment → one ledger grant (unique). Duplicates are idempotent; failures/mismatches grant nothing.
- `HANQ_PAYMENT_PROVIDER=test` is refused in production at startup; the default `none` answers 503 honestly.

## Errors and headers
- helmet defaults, `Cache-Control: no-store`, CORS allow-list with credentials, JSON body limit 256 KB.
- Error bodies use fixed messages; 5xx logs contain only the error class and driver code.
