# Current opening-era release: one ordinary UI check not verified

Owner approved excluding only `scripts/test-joseon-quiz-scopes-browser.cjs` after the Chromium child crashed in official run `43395996269`. This check did not pass and is not represented as passed or skipped-success.

This release candidate runs 83 unique FE files / 85 invocations. The original FE test remains in the exact 3027-file source inventory; the preload adapter and its regression remain. No authentication, provenance, integrity, resource, database, or migration exception policy is changed by this UI exclusion.

Follow-up: diagnose Chromium failure, restore this single entry in the harness/ops/pin test lists and restore 84-file / 86-invocation receipt/TAP expectations before treating the next release as full UI coverage. Do not silently carry this exclusion forward.
