# Hongmungwan independent practice

Additive owner-private manual-question API with eight eras. GET /api/v1/hongmungwan?era= returns items, eras and resetAt. Item: questionId/version/era/item/review/recentResults (newest first)/starred/everWrong/source=book-manual. Review: {correctOptionId,item}. Manual source itself is review/PDF eligible; no fabricated outcomes.
POST /answer: questionId/version/optionId/submissionId/reviewOnly/resetAt. PUT /star: questionId/version/starred/resetAt. Existing JWT/member/premium gates retained. Real practice writes isolated history, review-only writes nothing, XP and CBT untouched. Reset hides history/stars but preserves original sources.
Implementation only. Before release preserve current runtime overlays, trial migration 064 with backup/grants, test owner isolation, verify protected original images (some predate round70) and logged-in FE/PDF. No static public republishing.
