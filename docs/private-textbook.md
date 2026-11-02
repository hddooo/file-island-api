# Member-only private textbook study

This change is code only. It does not upload, publish, deploy, create users, change credentials, or configure production storage. Existing CBT/exam behavior is unchanged.

## Required setup before activation

1. Access is available to every existing HanQ member with a valid JWT and live session. Anonymous, invalid-token, expired-token and revoked-session requests remain denied. No premium pass is required.
2. By default the API reads only the exact `projectRoot()/private-textbook-data` bundle in the PRIVATE backend repository. No new hosting disk, credential, or storage subscription is required. An absent/unreadable bundle returns 503 after authentication. `HANQ_TEXTBOOK_OWNER_USER_ID` is obsolete and ignored. An optional absolute `HANQ_TEXTBOOK_DATA_DIR` can select an existing external private read-only mount; malformed explicit values fail startup.
3. This is a server-only bundle, never a frontend/static/CDN asset directory. The service rejects the repository root, every other repository subdirectory (including `public` and `dist`), symlink root aliases, and symlink asset paths. Keep this backend repository private. Never add a static mount, public file URLs, or copy this bundle into the frontend repo, Vercel assets, or public buckets. Deployment must verify no reverse proxy or other service exposes the directory. No original PDF or active SVG is needed in the runtime bundle.
4. Verify all four routes with no session, two different members’ live sessions, and a revoked session on the deployed system before use. This local implementation does not create accounts or deploy data.

The source PDF, extracted JSON, and page images remain private. There are no static mounts, signed public URLs, PDF-download route, role shortcuts, or premium-access shortcuts.

## API

All routes require `Authorization: Bearer <access token>` through the existing JWT authentication and live-session verification, followed by the member/data-configuration guard. Responses have `Cache-Control: private, no-store` (the global middleware also applies no-store to authentication failures). Clients must fetch image bytes with the bearer header and display a temporary blob URL; revoke it on navigation/logout. Never put access tokens into URLs or persistent browser caches.

- `GET /api/v1/textbook/manifest`: safe metadata and page list, without filesystem paths.
- `GET /api/v1/textbook/pages/:page`: minimal reading metadata with filesystem references removed recursively: page references, dimensions, preserved region/viewport bounds and source span sizes/bounds. The slim runtime omits raw wording, characters, vector paths and embedded-image objects; original wording/layout remains in the byte-identical authenticated PNG renders. Unverified extraction must not be described as human-reviewed content.
- `GET /api/v1/textbook/pages/:page/image`: authoritative original page render as PNG.
- `GET /api/v1/textbook/pages/:page/enhanced`: enhanced PNG render; active SVG is never served. Missing enhanced assets return 404; unconfigured/unreadable storage returns 503, so clients should retain the source-image view.

`:page` is the canonical one-based PDF page number (no leading zero), not the printed page label. Paths are constructed from fixed directories and `page-NNN` names, checked against manifest entries, resolved within the private mount, and opened without following final symlinks. Errors contain no filesystem paths. JSON and image reads are bounded; invalid PNG signatures are refused.

Manifest schema: `source.pageCount` must match sequential `pages[].pdfPage`; each entry must use `pages/page-NNN.json` and `renders/page-NNN.png`. The page file must have matching `pdfPage` and a `textBlocks` array. The full extraction archive stays outside repositories; only the approved minimal runtime bundle belongs in the private backend repository. Source SHA-256 and byte count in the manifest are provenance metadata; the server does not rehash the entire PDF on every request.

## Verification

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. `test/unit/textbook.test.ts` uses the actual Nest routing, JWT guard and member guard with a fake authentication service (no real database, tokens, accounts, or source assets). It covers every content route, anonymous/invalid-session/two-different-members behavior, missing bundle, malformed configuration, exact bundled-root allow-list, traversal, symlink rejection, repository-root rejection, PNG validation, path redaction, geometry preservation, and absent static routes. It does not replace deployed real-session/end-to-end tests.

Full PostgreSQL integration tests require the repository's separately configured disposable loopback test database. Do not run them against production.

## Semantic preview (data installation requires separate approval)

The separate `private-textbook-semantic-data` directory is server-only. This code change does not copy, upload, or publish textbook content there. Current exact route/file allowlist:

- `semantic/manifest` → `manifest.json`, schema `hanq-semantic-manifest/1`, `quizzes:[{id:"prehistory"}]`, `pages:[{pdfPage:12}]`; either list may be empty.
- `semantic/quizzes/prehistory` → `quizzes/prehistory.json`, schema `hanq-source-quiz/1`; quiz pairs must carry source-verification flags.
- `semantic/pages/12` → `pages/page-012.json`, schema `hanq-semantic/1`; original review status is preserved.
- `semantic/figures/p012-figure-1` → `assets/p012-figure-1.jpeg`, checked JPEG, returned with `image/jpeg`.

Every route inherits JWT/live-session and member guards with private no-store. Unknown IDs are 404; missing, malformed, oversized (over 2 MiB), or symlinked files are 503. No directory listing, arbitrary filename, active SVG, static mount, or public asset URL is introduced. JSON filesystem-path fields are removed. Figure IDs must be fetched using the guarded endpoint with Authorization and a revocable browser Blob URL. Until an approved installation exists, valid members receive 503 and anonymous requests receive 401. Native-text rendering must use safe text nodes, never execute content as HTML.
