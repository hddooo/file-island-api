# Manual PG17 app compatibility

This independent path was written from the existing 3af9 repository. It does not
implement or reconstruct the unavailable hosted qualification packet.

The existing source CI remains required. `workflow_dispatch` can additionally
opt in with `pg17_app_compat=true`; push events never start the DB job. The job
has `contents: read`, uses GitHub-hosted Ubuntu, and accepts no application
secrets, operating URLs, private fixture inputs or database configuration.

The runner resolves the official `postgres:17-bookworm` image once, records its
repository digest and image ID, and starts that immutable digest with a randomly
generated disposable password. PostgreSQL is published only on 127.0.0.1 at a
dynamic port. The actual server must report server_version_num in [170000,
180000). The generated database ends in `_test`; existing test helpers enforce
loopback/test-only schema reset. This path deliberately does not test TLS.

The existing, unchanged integration files run serially through the real NestJS
application, repositories and PostgreSQL:

- auth.test.ts
- admin-partner-xp.test.ts
- hall-public-profile.test.ts
- profile-attempts.test.ts
- growth-history.test.ts

Only these five files run. All other integration files are excluded, rather than
silently skipped. A generated 30-item quiz/10-item mock synthetic catalog supplies
the existing catalog helper; no real question, answer, textbook or audio fixture
is fetched. These assertions cover auth/cookies/CSRF, selected and legacy XP,
Hall privacy, own profile/attempts and own growth records. They do not establish
real catalog/media coverage or full integration qualification.

The checked-in lock pins application source, SQL, all existing tests, package
manifests and Dockerfile to immutable 3af9 blob IDs. The new CI commit SHA comes
from the actual checkout/event, avoiding a self-referential checked-in commit.
The existing exact SQL55/privileges contract is enforced before DB creation and
against the applied migration rows after tests. Fresh synthetic schema creation
is not a 54-to-55 upgrade qualification.

Raw TAP, generated passwords, database URLs and response payloads remain only in
process memory. Only sanitized file counts, exit/signal, source SHA, PG version,
image digest/ID, SQL hashes and cleanup state go to the result artifact. Every
selected file must have positive tests, zero failed/skipped/cancelled/todo and
exit zero. The owned container/anonymous volume and temporary fixture are removed
in finally; cleanup failure fails the result.

Success means PG17 app compatibility for this selected synthetic subset only.
It provides no independent-cluster backup/restore, verify-full TLS, 056 upgrade,
production data preservation, image/runtime smoke, six-suite, API CD or operating
DB qualification. All qualification flags remain false. No main promotion or
operating changes are performed here.
