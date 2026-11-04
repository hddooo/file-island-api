# Private immutable Joseon Script transport

This additive backport starts at `96c6b7a1fdc16660edb97676ed5f8a5ba1b3d4ec`, the documented deployed `987be5798893b0023674a194626704a9d5033a37` source snapshot. It does not merge current API main or its revision routes. AGENTS.md and README.md were read; this baseline has no docs/COLLABORATION.md or .agents/skills directory.

## Contract

`GET /api/v1/textbook/scripts/joseon/:sourceSha256/bundle` returns the exact `hanq-joseon-script/1` JSON bundle (no envelope).

`GET /api/v1/textbook/scripts/joseon/:sourceSha256/figures/:name` returns original PNG bytes as `image/png`. Names are exactly the 38 `pNNN-NN.png` entries in `joseon-script.pin.ts`; these are unrelated to legacy semantic figure IDs.

Both use existing JwtAuthGuard (Bearer token plus live session) and TextbookMemberGuard. No member, role, premium, session, cookie or source-edition policy changes. Exact source selection is this separate Script gate; it does not activate canonical PDF/quiz revision readiness. No saved answers, attempts, progress, aliases or migration.

Source SHA256: `8d0944e32d86985a4af3dbf28085dba4bb3f65cc0d8379907e2e4693299003a1`, original MD 92125 bytes. Bundle SHA256: `32a33b006d1c4b113dcc2e9df23a81e14b7b07ce2afe7400eafdde9f8750386b`, 113709 bytes. Original MD plus 38 PNGs total 19544896 bytes. The source PDF hash and legacy quiz-version hashes are not Script hashes.

Headers before authentication: `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-site`. Auth failures use existing 401 error codes. Unknown source or name: 404 `not_found`. Missing/invalid/partial source: 503 `script_unavailable`. Errors use existing `{error:{code,message}}` JSON; image failures never return HTML or image MIME. Unsupported mutation routes do not exist (Express may support implicit HEAD for GET).

FE adapter must require the exact reviewed source and response type, accept AbortSignal, and return a raster Blob. `ready` denotes reviewed wiring, not permission or guaranteed content availability. Clear reader drafts/blobs on session or route change. Existing canonical quiz navigation remains separate and keeps its revision gate.

## Private placement and rollout boundary

Fixed runtime directory: `/run/hanq-private-script/history/joseon/81-2026/8d0944e32d86/`. Place only `bundle.json`, original `scirpt.md` and the 38 original PNG filenames there. Stable object-key prefix: `history/joseon/81-2026/8d0944e32d86/`.

Read-only bind mount only this edition directory. No admin volume sharing, public static route, public URL, arbitrary file endpoint or environment-selected JSON path. All file bytes, signatures, dimensions and sizes are verified before any delivery. Symlinks/junctions at ancestors or leaves are refused. A successful process holds immutable verified bytes in memory (approximately 20 MB); disk replacement cannot switch its edition. Restart to reverify. Failed loading exposes no partial edition and may retry after repair.

Keep inputs outside Git, build contexts, CI artifacts and registries. Code-only image construction must not copy Script inputs. Existing Dockerfile still references missing legacy private assets, so do not call it a safe new release image without an independently reviewed build path. Never run npm start/migrate against production. Preserve the existing mounted `/run/hanq-production/bootstrap.mjs`, runtime settings and all old roots; no schema changes are required.

Rollout sequence: verify baseline compiled-source comparison; pass code and isolated API/FE tests; review exact changed files and code-only image; place/reverify narrow private source mount; retain previous image and full service configuration privately; use existing bootstrap to start candidate; verify health and anonymous/invalid denial; verify member flow explicitly; switch using existing deployment mechanism. Roll back to retained image/configuration and remove only the new mount from service configuration. Do not delete original materials or mutate database data.

## Validation

`npm run typecheck`, `npm run lint`, `npm run build`, `npm test` run without operational configuration or DB. New tests use entirely synthetic sources and sessions and cover exact bytes, denied/revoked sessions, source/name mismatch, traversal, missing/changed content, schema, size/signature, symlink, immutable cache and absent writes.

`test/helpers/serve-joseon-script-fixture.ts` is an explicit NODE_ENV=test harness with synthetic-session authentication and the real controller/guards/service. It never imports production AppModule or starts migrations. Publish port 18081 on host loopback only, mount verified private local input read-only, and use it for FE integration. This is not real-account verification. Do not ship the fixture server as a production entrypoint.

## Evidence recorded 2026-11-04

- Running `hanq-api-staging` image still labels source `987be5798893b0023674a194626704a9d5033a37`. All 149 deployed compiled source JS files match a build of snapshot `96c6b7a` after LF normalization. The differences before normalization were Windows CRLF inside existing multiline strings, not code changes.
- Final isolated Node24 `typecheck`, `lint`, `build` and full unit suite pass: 304 tests, 301 passed, 3 existing optional-fixture skips, 0 failures. Existing FE catalog and deployed legacy semantic files were supplied read-only. Initial missing-fixture runs are not counted as passing runs.
- New HTTP tests exercise real TokenService, AuthService.authenticate, JwtAuthGuard and SessionsRepository with an isolated SELECT-only pool double. No real credentials, account writes or database connection. The duplicate-manifest negative test selects an unchanged allowlisted figure so it tests unavailable content rather than unknown-name routing.
- Private local original input validation: 39 original files, 19544896 bytes; derived bundle adds 113709 bytes. Isolated HTTP delivery returned exact bundle hash and all 38 exact original PNG hashes; anonymous delivery was 401 with private headers.
- The FE integration harness is available on host loopback 18187 only. Its synthetic token is test-only and unrelated to production sessions. FE/index integration evidence is reported separately by the FE task.
- Production placement, release image/service replacement, public-domain endpoint verification and real-member verification are **pending**, not implied by passing isolated tests. No production source, auth, mount, settings or data was changed.

### Concrete minimal backport handoff

Only four production compiled files are needed: `dist/src/textbook/textbook.module.js`, `joseon-script.controller.js`, `joseon-script.service.js`, `joseon-script.pin.js` (four files total; the source identity pin is code metadata, not private content). Existing compiled files outside textbook.module remain byte-identical. Use a clean build, excluding the test harness and private sources.

Before applying a patch to the retained deployed image, verify its exact image ID and all baseline hashes again. A local derived image may replace these four code files while retaining the existing runtime and bootstrap; it must not be pushed to any registry because the existing base already contains legacy private material. A truly code-only registry image requires a separately reviewed legacy-material mount/build path and is not supplied by this backport. Do not use latest main or the unchanged repository Dockerfile as a shortcut.

Mount only the approved edition directory at the fixed runtime directory, read-only, preserving all pre-existing mounts/settings. The API does not accept an admin cookie, public file URL or arbitrary root override. If the approved file-server copy is public, that does not change this API's private session contract. Rollback restores the retained exact prior image/configuration; it does not remove source files or run SQL.
