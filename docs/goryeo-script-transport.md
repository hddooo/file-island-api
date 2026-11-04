# Goryeo Script private transport

Local implementation only. Base: `ee9487e96fe95c441c3091a6f3d45a4c211d51b8`.
No API main integration, publishing, runtime changes, migrations or production auth calls are part of this change.

## Contract

Prefix: `/api/v1/textbook/scripts/goryeo/245d166b2a252293903f87654028a648772f8c78dbb8ade09c86a21a223bb5a9`.

- `GET {prefix}/bundle`: exact immutable JSON bytes (`application/json`), schema `hanq-goryeo-script/1`.
- `GET {prefix}/figures/{name}`: allowlisted original PNG bytes (`image/png`).
- Existing JWT/live-session authentication followed by `TextbookMemberGuard`. All authenticated members retain the existing policy; this adds no premium/role exception.
- `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-site`, including guard denials.
- Existing JSON error envelope: unauthenticated/invalid/revoked session 401; unknown source or filename 404; incomplete or invalid edition 503 `script_unavailable`. No old-source fallback.
- No write, progress, upload or canonical quiz mapping endpoints. Express retains its standard implicit HEAD behavior for GET routes.
- A closed response aborts its delivery. Shared bounded verification may finish for other readers, but an aborted reader never receives bytes and cannot poison the cache. FE must still abort requests and revoke Blob URLs on account/route changes.

## Immutable identity

| Input | Bytes | SHA256 |
|---|---:|---|
| `scirpt.md` | 60806 | `245d166b2a252293903f87654028a648772f8c78dbb8ade09c86a21a223bb5a9` |
| `bundle.json` (reviewed bundle v2) | 74046 | `ed4fcfab4b25b0e896c93bcfe0240372b70da0fcbb22c1fa81afad14bbc71943` |

The 24 PNG identities, byte counts and dimensions are in `src/textbook/goryeo-script.pin.ts`. Raw inputs total 25 files / 12,501,470 bytes. With bundle: 26 files / 12,575,516 bytes. MD SHA identifies the source; bundle SHA binds converted bytes separately. No PDF or canonical question identity is changed.

Fixed runtime directory: `/run/hanq-private-script/history/goryeo/81-2026/245d166b2a25`.
Storage key prefix: `history/goryeo/81-2026/245d166b2a25/`.
Files and every directory ancestor reject symlinks/junctions. Reads require regular files, exact sizes/hashes, bounded allocation and PNG signature/IHDR/dimensions. All 26 files must verify before any bundle or figure is served. Maximum sizes: MD 256000, bundle 512000, PNG 2000000 bytes. No user-selected filesystem roots or environment JSON paths.

## Future rollout, not executed

1. Recheck current image `sha256:d9c915d642b9771734fca400e2a466613af177a8f70cb28d4d982b8e885bf534`, current source hashes, original Compose/bootstrap hashes and existing Joseon override. Preserve these exact artifacts locally.
2. Complete isolated API/FE integration and Linux file-symlink tests before release. This Windows environment cannot create file symlinks; directory-junction rejection is tested separately.
3. One-time copy only `scirpt.md`, the 24 allowlisted PNGs, and reviewed bundle renamed `bundle.json` into a new API-private Goryeo edition directory outside Git/build/static roots. Verify every hash, size and exact directory inventory before use. Do not modify existing originals or mount the admin volume.
4. Derive a local code-only layer from the retained current Joseon image. Add `goryeo-script.controller.js`, `goryeo-script.service.js`, `goryeo-script.pin.js`; replace only `textbook.module.js` to register them. Keep current bootstrap/command and all other compiled sources. The base contains private legacy data: never push this image to a registry.
5. Add a separate Goryeo Compose override selecting that image and exactly one read-only edition bind to the fixed runtime directory. Apply **original Compose + retained Joseon override + new Goryeo override**, in that order. Preserve all original configuration, mounts and guards; no generic `npm start` or migration command.
6. Check health, anonymous/invalid GET denials and headers on API and FE proxy hosts, runtime file hashes and readonly mount. A legitimate existing member session may prove reads; do not create fake production sessions or account/progress writes.
7. Goryeo-only rollback uses **original Compose + retained Joseon override** and the retained `d9c915...` image, removing only the new edition mount. Do not invoke the old Joseon rollback (which returns to pre-Joseon), and do not use original Compose alone. Keep the Goryeo source directory for investigation; no deletion required.

Existing durable Joseon reapply/rollback files remain untouched. Later deployment artifacts must preserve explicit combined Compose ordering; a plain original-Compose `up` can remove both additions.

## Local verification

Synthetic tests exercise byte delivery, live-session rejection, exact source selection, traversal, missing/tampered files, schema and duplicate pin entries, PNG signature/HTML/dimensions/size, bundle/source limits, directory junctions, cancellation, immutable cached bytes and no writes.
Existing textbook/member, semantic transport, session and source-progress tests are run separately from actual-source verification. Actual original data is checked only in a temporary isolated directory outside this repository and removed afterward; no real user account is used.

Windows regression result: 60 tests, 55 passed, 4 pre-existing file/directory-symlink privilege failures, 1 explicit Goryeo file-symlink skip. The Goryeo tests alone have 22 passes and 1 skip; ancestor junction and cancellation tests pass. The four unchanged failures are in Joseon (1), semantic-data (1), textbook (2), all `EPERM` while creating test links. These are a remaining Linux verification requirement, not a passing suite claim.

Typecheck, lint and production build pass. Recompiling the exact base and candidate with the same compiler gives 152 baseline / 155 candidate source JS files: 151 unchanged, only `textbook/textbook.module.js` replaced, three Goryeo JS files added. Baseline output normalized to LF matches all 152 recorded current-runtime hashes; unrelated auth, growth and progress code is unchanged. A future image should copy only the four enumerated files, rather than the whole Windows build directory.

The verified actual-source service test delivered bundle 74046 bytes and all 24 PNGs (12440664 bytes), matching every pinned hash. This proves isolated source loading, not a production member session or FE integration.

Availability invariant: with absent, partial, or corrupted Goryeo files, the real TextbookModule controller/provider registrations initialize successfully. Goryeo GET returns 503 while actual HealthController returns 200, AuthController retains its unauthenticated guard denial, and valid synthetic Joseon bundle/PNG GETs retain exact bytes before and after the failed Goryeo reads. DB health is stubbed and auth rejection occurs only on the isolated loopback server; there are no production auth requests.
