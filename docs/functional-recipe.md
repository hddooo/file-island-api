# Six-suite execution recipe

The committed recipe runs api-unit, api-integration, migration-compatibility, fe-unit, core-ui and deploy-controller. Required case IDs map to real passing TAP titles. Failure, skipped/todo/cancelled cases, missing summaries, timeouts and nonzero exits reject qualification.

## Inputs and scope

Run node scripts/prepare-functional-plan.cjs with a local non-secret JSON input. Its KEYS list accepts exact source roots/commits, image/archive receipts, compose/bootstrap paths, the existing readonly semantic directory, output path and immutable browser-tools image. Credential fields are rejected. The API SHA is observed from the clean checkout; frontend/deploy SHAs are explicit. The image must be rebuilt from that exact final API SHA.

Original round-with-checks.prepared.json is not a CI input. All67 unit source files remain inventoried by exact Git blob/SHA256. Both CI producers execute exactly62, using only the five existing exclusions in ops-prep/private-ci-exclusions.json. Three optional original-only TOEIC cases remain under test/local-original outside CI; their public evidence invariants remain in unit tests. No skipped CI result qualifies.

The existing semantic298 input stays readonly, with aggregate3837183b92605f8ffeb1eeba490f0b599c9c78569c31d8d6311a32d2439b0846 checked before/after execution. It is not copied into images. Only the synthetic revision HTTP test gets a temporary synthetic default144 context; candidate application, SQL and test byte identities are checked. No real147/raw revision root is activated.

The FE list contains46 tracked Node scripts, retaining all45 original paths. The deploy list contains22 files retaining native ACL/install/management/interlock/watchdog/current-release/workflow coverage and the legacy root recovery test. The reviewed LF controller bundle is827cc3771494682555dfb2776d1557f1ca15c2ccbc09bab4848f75869ebe8143.

Core UI uses exact committed FE assets, actual candidate API and an owned network-none PG17 namespace without host ports. The official Playwright1.64.1 amd64 image and exact FE lock are pinned in the handoff. Chromium/WebKit run as existing non-root pwuser with unchanged read-only/cap-drop/no-new-privileges settings. The synthetic clock starts at browser wall time to keep real cookie expiry valid, then uses the existing bounded clock control. No application TTL/cookie/CSRF policy changes.

## Execution and authorization

Inside the approved API main/manual Actions run, execute node scripts/run-functional-evidence.cjs qualification-inputs/plan.json qualification-inputs/roots.json release-evidence.json. All three checkouts must match exact clean commits. Existing Windows Docker and locked FE Node dependencies are required; no runner or credential is provisioned by these scripts.

Local diagnostics are not an authenticated six-suite Actions receipt. Runner scope, cross-repository Actions/Contents read authorization, reviewed controller installation and exact release cutover remain separate approvals. Operating API987/schema54, rememberEnabled=false, migration056 separation and the Vercel asset base are preserved.
