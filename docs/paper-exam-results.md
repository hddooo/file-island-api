# Completed paper exam records

Independent owner-scoped user reports. Never create cbt_runs, attempts, selected choices, online start/end times, growth awards, or attendance. No existing records are edited or removed. Reports and their 50 versioned item snapshots are append-only.

## API (JWT owner only)
- GET /api/v1/cbt/paper-results: {items:[summary],hasMore}, latest 200 by server report time.
- POST same route: {examRound,wrongNumbers,idempotencyKey,completed:true}. All omitted numbers mean reported-correct, not guessed choices. Empty wrong set =100; all 50 wrong =0. Original round 70–80, 50 ordered verified questions totaling100 required. Return {result:summary}. Same normalized payload and key retry returns original; conflicting payload409.
- summary: {id,examRound,source:'paper-reported',reportedAt,score,maxScore:100,correctCount,wrongCount,wrongNumbers,grade,selectedAnswersKnown:false}. reportedAt is receipt time, never alleged completion/start time.
- GET /api/v1/cbt/paper-results/:id: owner-only summary, another owner404.
- GET /api/v1/cbt/paper-results/notebook: {scope:'paper-reported-wrong',limit:500,hasMore,items}. Existing CBT notebook-shaped items except source='paper-reported', selectedOptionId=null, all selected flagsfalse. Owner-only images /api/v1/cbt/paper-results/:id/questions/:position/image and /common.
- Notebook and images honor wrong-note history resets; score history remains. Later correct reports do not erase earlier wrong membership. Frontend explicitly merges ordinary and paper notebooks, deduplicates question/version and surfaces failures/overflow. These endpoints do not silently inject into online CBT stats/history.

## Rollout
Based on production 836ed77e2d7e51569c5800b9c4567c4fbfa7526d; adds only069, independent of pending065–067. No record insertion occurs on migration. Use existing reviewed npm run migrate (dist/scripts/migrate.js), with approved owner credentials/environment via established deployment workflow. Verify prior migration checksums and backup first. Runner uses advisory lock/checksums and reapplies existing privilege restrictions. Do not bypass approved migrations-tree gate. Confirm existing app role can access new tables without broad permission changes. API before frontend. No deployment/write authorized by this document alone.

## Verification
Build/typecheck/unit tests. Disposable PGlite PostgreSQL rehearsal:
PGLITE_MODULE=/absolute/pglite/dist/index.cjs PAPER_EXAM_POOL=/absolute/verified/media/exam-pool.js node test/local-diagnostic/paper-results.cjs
Entire migrations/replay; weighted scoring using synthetic wrong sets; owner/idempotency/conflict; 100 snapshots,9 synthetic wrongs; shared image; resets; immutable records; unchanged runs/attempts/XP/attendance/manual notes. No production connection.
