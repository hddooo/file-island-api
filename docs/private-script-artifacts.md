# Private script artifacts in the database

The authenticated script controller serves structure data from an append-only database table. No structure payload, source-derived validation constant, presentation content or private import manifest belongs in Git.

- The exact-source structure route returns the stored structure JSON bytes.
- The current structure route returns a bootstrap envelope containing structure, presentation and workspace data. The existing server-owned script identity selects the source.
- Existing script headers, JWT/live-session and member guards apply unchanged. There is no filesystem fallback, anonymous route or access-policy change.
- Generic size and digest validation binds each row to the existing verified source bundle. Structure projection and bundle identities are verified. Presentation workspace metadata is compared with the actual existing quiz. Progress keys and quiz versions remain unchanged.
- One row per era, artifact kind and source identity is immutable. Imports use insert-on-conflict-do-nothing, then compare all identities and payload bytes. A differing payload is an error, never an update.

## Explicit targeted deployment

The schema file is under migrations/targeted and is deliberately ignored by the general automatic migrator. Run only the explicit private-script-artifact operator command. Never run the general migrator as part of this rollout.

Before production execution, independently verify the backup and restore, exact database/schema identity, all prior migration receipts, current creating role, API role access and current default privileges. The restored clone does not reproduce production ACLs when restored without owners/privileges, so clone success is not production permission evidence.

The targeted runner normalizes SQL line endings to LF, validates the complete baseline receipt set and applies only the one additive table plus its receipt in a transaction. Unsafe public schema access or non-owner table defaults cause refusal. It does not issue grants, revokes, role changes, default-privilege changes, deletes or updates. Do not loosen its checks or change permissions to overcome a refusal.

Operator entrypoint after building: dist/scripts/private-script-artifact.js.
Actions are schema --apply or import followed by private identity-manifest, payload and matching bundle file paths, then --apply. Existing connection configuration is supplied by the operator; no .env auto-load or credential logging is added. Payload values and dataset-specific validation criteria come only from private inputs and the database.

Deploy code with the existing bootstrap and mount/security settings unchanged. Missing schema/rows or corrupt content fail only the private structure route. Rollback restores the prior application image and leaves the additive table, row and receipt intact. It does not delete learning history or new data.

## Validation boundaries

Synthetic tests cover generic integrity, exact/current response shape, source/bundle/workspace binding, corruption and missing data. A new disposable loopback database tests the targeted migration, unchanged sentinel/ACL state, concurrent insert, identical retries and immutable conflicts without executing the general migrator.

A separate authorized restored-database rehearsal uses actual private inputs outside Git. It checks original table counts and prior receipts, new artifact rows, idempotency, conflict rollback, real application DI and authenticated HTTP boundaries. Production apply and production ACL verification are separate release gates.

For payload delivery without new mounts or container files, import-stdin --apply accepts a bounded JSON object with identity, payloadBase64 and bundleBase64. The two base64 strings must be canonical and stay within generic size limits. The importer never logs their contents.

Do not assume overriding a production entrypoint preserves credential initialization. The deployment owner must verify the existing bootstrap-supported operator execution path and actual database role before any production call. Isolated clone CLI validation is not evidence that a production bootstrap override is safe.
