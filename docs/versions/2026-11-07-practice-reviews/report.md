# Practice review PDF source access

## Plan
Add an authenticated read-only endpoint for existing Practice source answers and explanations. Do not create answer attempts, growth events, or new inferred answers.

## Implementation and verification
GET /api/v1/toeic-cbt/collections/:id/practice-reviews returns collectionId and safe source items with review fields. Existing JWT guard, UUID validation, and learningOwner collection authorization are unchanged. Transaction is READ ONLY; private no-store cache policy is explicit. Incomplete source material is omitted; inferred answer status remains unverified.

Four focused tests cover source field fidelity, zero writes, published notebook scope, unavailable collection rejection, and incomplete/inferred answer handling. Type checking passed. Runtime deployment must layer only compiled practice.js and module.js on the current image and preserve all mounts/settings. Deployment evidence is retained locally without private source data or credentials in this repository.

Full local suite: 363 tests, 344 passed, 13 failed, 6 skipped. Failures concern absent private textbook fixture data/environment paths and Windows symlink privilege; no new Practice review test failed. Focused lint passed.
