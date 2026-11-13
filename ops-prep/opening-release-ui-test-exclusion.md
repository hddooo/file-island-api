# Current opening-era release: two ordinary UI checks not verified

Owner approved excluding only `scripts/test-joseon-quiz-scopes-browser.cjs` after the Chromium child crashed in official run `43395996269`. This check did not pass and is not represented as passed or skipped-success.

This release candidate runs 82 unique FE files / 84 invocations. The original FE test remains in the exact 3027-file source inventory; the preload adapter and its regression remain. No authentication, provenance, integrity, resource, database, or migration exception policy is changed by this UI exclusion.

Follow-up: diagnose Chromium failure, restore both entries in the harness/ops/pin test lists and restore 84-file / 86-invocation receipt/TAP expectations before treating the next release as full UI coverage. Do not silently carry this exclusion forward.

Second confirmed failure: `scripts/test-opening-glossary-expansion-browser.cjs` reached a tooltip visible assertion but returned a null bounding box in the diagnostic. Owner-authorized ordinary failing UI exclusion applies; tooltip browser layout/timing remains unverified. Original source and all security checks remain.
