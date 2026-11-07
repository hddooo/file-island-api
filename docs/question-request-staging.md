# Private question request staging (not deployed)

## Implemented contract

Authenticated callers use /api/v1/question-requests. Create and list; detail/PATCH/:id/submit only for the owner. The user ID always comes from the live JWT, not the body. /api/v1/ops/question-requests lists and reviews through the existing DB ADMIN role check on every request. No roles, existing ownership, login or sharing settings change.

Create: requestId (UUID idempotency key), subject toeic|history, TOEIC part 1..7 only, sourceLabel, questions[], note. Each question carries number, stem, ordered choices, manually provided correctOptionId, optional passage/imageAssetId/audioAssetId. History IDs 1..5; TOEIC A..D, Part2 A..C. Empty draft allowed; answers never inferred. PATCH adds expectedRevision and retains original requestId.

POST /:id/assets uses application/octet-stream with query assetId (client UUIDv4), expectedRevision, purpose source_image|clean_image|audio, mediaType. Owner-only; ops equivalent checks ADMIN. Same UUID/hash/type/purpose replay succeeds without duplicate bytes, different content conflicts. Image limit8MiB, audio16MiB, max30 assets/64MiB per request,256MiB per owner. PNG/JPEG/WebP or MP3/WAV signature validation only, not full OCR/decode validation. SVG/HTML rejected. No remote URL fetch and no external OCR transmission. Assets remain DB bytea, owner/admin GET only with no-store/nosniff/CSP sandbox. Existing256KB JSON limit unchanged. No public static assets, file-system mounts or credentials added.

Create result id is distinct from requestId; detail returns {request,assets,capabilities}. Mutations return {id,status,revision}; asset result returns {id,revision,size,mediaType,purpose,replayed?}. Refresh detail after ambiguous outcomes.

## State machine

draft/needs_revision -> owner edits -> draft; owner submit -> submitted. Submission needs questions, explicit answer, text for history/Part3..7, source image except Part2, and linked audio for Part1..4. Asset references must belong to the request.

ADMIN submitted -> needs_revision or content_reviewed. Content approval requires sourceChecked=true and one nonempty explanation per question. content_reviewed -> needs_revision or ready_for_publish. Second approval requires cleanImageChecked=true and a clean_image asset. Owner/admin can add clean_image in content_reviewed without changing reviewed content. No direct state skip. Revision mismatch409. No deletion endpoints. Existing learning data untouched.

Capabilities: mediaUpload=true; ocr=false, automaticReview=false, publish=false. ready_for_publish is NOT published. There is no publish endpoint, no automatic assistant invocation, and no OCR worker in this implementation.

## Why publisher is separate

TOEIC Practice reads the explicitly published common owner. Importing under a personal owner would not show there; using the common owner changes the audience. LC group/audio/private-asset linkage must be integrated and tested before posting. History seedQuestions changes the entire current-version set; it must not be invoked with only new requests. Use a reviewed append-only publisher and explicit audience, preserving all current versions/attempts.

## Deployment gate

Migration057 adds only two staging tables/indexes; existing repeatable privileges must apply transactionally and runtime receives only necessary grants on new tables. No existing role expansion. Current production boot script pins the exact migration checksum manifest through055. Applying057 without a matching explicitly reviewed bootstrap manifest will make restart fail with Schema checksum contract. Do NOT apply migration or replace bootstrap casually. Source main already contains056, but production does not; do not run all main migrations. Stage exact057 and coordinate schema validation/rollback first.

Compiled overlay needs only portal/portal.module.js plus question-request.controller.js, question-request.dto.js, question-request.service.js, question-request-media.js. Keep current app.module.js and all other runtime overlays/mounts/env/entrypoint unchanged. Rollback must preserve newly submitted requests and assets, never drop tables or remove migration records merely to fit the old checksum gate.

## Verification

Typecheck/lint and unit validation tests; isolated synthetic PostgreSQL HTTP test covers authentication, owner isolation, upload idempotency, stale revision, sequential review gates, private asset reads and no fake published transition. No production writes or real user record tests.
