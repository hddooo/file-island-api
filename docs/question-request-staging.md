# Question requests and member-only publication

## Implemented contract

Authenticated callers use /api/v1/question-requests. Create and list; detail/PATCH/:id/submit only for the owner. The user ID always comes from the live JWT, not the body. /api/v1/ops/question-requests lists and reviews through the existing DB ADMIN role check on every request. No roles, existing ownership, login or sharing settings change.

Create: requestId (UUID idempotency key), subject toeic|history, TOEIC part 1..7 only, sourceLabel, questions[], note. Each question carries number, stem, ordered choices, manually provided correctOptionId, optional passage/imageAssetId/audioAssetId. History IDs 1..5; TOEIC A..D, Part2 A..C. Empty draft allowed; answers never inferred. PATCH adds expectedRevision and retains original requestId.

POST /:id/assets uses application/octet-stream with query assetId (client UUIDv4), expectedRevision, purpose source_image|clean_image|audio, mediaType. Owner-only; ops equivalent checks ADMIN. Same UUID/hash/type/purpose replay succeeds without duplicate bytes, different content conflicts. Image limit8MiB, audio16MiB, max30 assets/64MiB per request,256MiB per owner. PNG/JPEG/WebP or MP3/WAV signature validation only, not full OCR/decode validation. SVG/HTML rejected. No remote URL fetch and no external OCR transmission. Assets remain DB bytea, owner/admin GET only with no-store/nosniff/CSP sandbox. Existing256KB JSON limit unchanged. No public static assets, file-system mounts or credentials added.

Create result id is distinct from requestId; detail returns {request,assets,capabilities}. Mutations return {id,status,revision}; asset result returns {id,revision,size,mediaType,purpose,replayed?}. Refresh detail after ambiguous outcomes.

## State machine

draft/needs_revision -> owner edits -> draft; owner submit -> submitted. Submission needs questions, explicit answer, text for history/Part3..7, source image except Part2, and linked audio for Part1..4. Asset references must belong to the request.

ADMIN submitted -> needs_revision or content_reviewed. Content approval requires sourceChecked=true and one nonempty explanation per question. content_reviewed -> needs_revision or ready_for_publish. Second approval requires cleanImageChecked=true and a clean_image asset, except TOEIC Part2 which requires audioChecked=true and its audio asset without any photo. Owner/admin can add clean_image in content_reviewed without changing reviewed content. No direct state skip. Revision mismatch409. No deletion endpoints. Existing learning data untouched.

Staging release c8f1627 has publish=false. The publisher candidate adds publish=true and the explicit ADMIN routes below; ready_for_publish is still NOT published. No automatic assistant invocation or OCR worker is added by this backend.

## Why publisher is separate

TOEIC Practice reads the explicitly published common owner. Importing under a personal owner would not show there; using the common owner changes the audience. LC group/audio/private-asset linkage must be integrated and tested before posting. History seedQuestions changes the entire current-version set; it must not be invoked with only new requests. Use a reviewed append-only publisher and explicit audience, preserving all current versions/attempts.

## Deployment gate

Migration057 adds only two staging tables/indexes; existing repeatable privileges must apply transactionally and runtime receives only necessary grants on new tables. No existing role expansion. Current production boot script pins the exact migration checksum manifest through055. Applying057 without a matching explicitly reviewed bootstrap manifest will make restart fail with Schema checksum contract. Do NOT apply migration or replace bootstrap casually. Source main already contains056, but production does not; do not run all main migrations. Stage exact057 and coordinate schema validation/rollback first.

Compiled overlay needs only portal/portal.module.js plus question-request.controller.js, question-request.dto.js, question-request.service.js, question-request-media.js. Keep current app.module.js and all other runtime overlays/mounts/env/entrypoint unchanged. Rollback must preserve newly submitted requests and assets, never drop tables or remove migration records merely to fit the old checksum gate.

## Verification

Typecheck/lint and unit validation tests; isolated synthetic PostgreSQL HTTP test covers authentication, owner isolation, upload idempotency, stale revision, sequential review gates, private asset reads and no fake published transition. No production writes or real user record tests.

## Member-only publisher candidate (not deployed until release evidence says otherwise)

Owner create/update accepts publicationAudience=authenticated-members only on explicit sharing consent; omitted is private. Consent changes require owner draft revision and both review gates again. ADMIN cannot provide consent for the owner. POST /api/v1/ops/question-requests/:id/publication-preview and /publish accept expectedRevision, audience=authenticated-members, mappings[{number,cleanImageAssetId?,groupId?}], groups[{id,questionNumbers,audioAssetId?,passage?}], optional historyClassification{chapter,era}. Preview returns ready, audience and blockers[{code,message}]. Publish returns id/status/revision/publication/replayed. Mapping input is frozen and hashed; same-input retry returns existing publication, any change conflicts. No new schema migration.

Publication runs in one transaction with existing ADMIN-role verification, row lock, expected revision, owner consent, completed source/second-media checks, source mapping verification, immutable source inserts, request state and audit. Source/marked photos are never copied into member delivery. No role/security-setting changes. No public sharing. No automatic crop/answer inference.

TOEIC: append a new request:<uuid> source under the already configured common notebook owner, never overwrite collections/attempts. All1..7 supported when actual groups and media exist: Part3/4 requires explicit complete three-question groups; Part6/7 requires verified passage grouping; absent metadata blocks. Part1 requires explicitly mapped clean image; Part2 can use audio+ABC without transcript or photo. Correct answer provenance is user-entered-admin-reviewed, not falsely labeled official. MP3/WAV remain DB bytes; internal private-audio markers never reach browser audioUrl. Practice and CBT safe responses expose authenticated audioPath=/collections/:id/audio/:groupId. Existing external audio sources remain unchanged. Clean images use existing private collection image storage.

History: append new quiz IDs request-<uuid>-<number>, immutable source/version/hash, points1 existing practice convention (not official exam weight). No full-set seeding/current recalculation, retirement, existing questions or attempts changed. Each question requires an explicit clean-image mapping and chapter/era. Server-created public_payload.visibility=authenticated-members causes the old unauthenticated public list/get/count to exclude only the new member entries. JWT /api/v1/published-history list/detail reads them. Existing /attempts and /quiz/progress provide server grading, review and existing personal progress. JWT /api/v1/published-question-assets/:requestId/:assetId only serves frozen publication asset IDs; original source images remain owner/ADMIN-only. Broader all-site sign-in policy is a separate rollout.

Optional question cropProvenance exactly accepts source_pixel_crop/decoded-image-exif-applied, originalSha256/outputSha256, sourceWidth/Height, crop{x0,y0,x1,y1}, outputWidth/Height, image/png, userConfirmed:true, generatedContent:false. Bounds/output dimensions are checked. At publication the original upload hash and explicitly mapped clean PNG hash/dimensions must match. The server does not claim it independently reproduced the client pixel crop or decoded original EXIF dimensions.

Publisher tests: isolated synthetic HTTP flow confirms owner sharing consent rejection, both review gates, idempotent TOEIC publication, real member Practice retrieval and DB audio playback, member history list/image access, anonymous denial on both old/new endpoints, original source image denial, real /attempts grading/review/idempotency and /quiz/progress, and unchanged prior question hashes/current flags. Related unit tests cover all seven parts, source-image rejection, actual group/passage requirements, deterministic append-only history and prior catalog invariants. No real production submissions are generated for verification.

Readonly dot review recovery: existing authenticated ADMIN GET /api/v1/ops/question-requests?page=N and GET /:id expose pending request state/assets; no worker trigger or dot login credential is provisioned. A persistent review automation requires a supported authenticated read channel and explicit review/write delegation, not direct secret extraction. The site does not automatically wake the dot in this release.
