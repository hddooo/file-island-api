# Current61 original-only regression boundary

The three TOEIC splits restore official commit efacae4e17588773cc7466f0782d0c3ca2ffa294. Their public unit invariants remain in the same unit paths. The opening original-only case uses the same boundary; all 118-question/119-slot, exact source, ordering, wrong-answer and mutation-rejection assertions remain unchanged. Exact source mapping is in current61-local-original-tests.json.

These four cases are not CI inputs and are not new CI exclusions. Existing five exclusions, CI originalFixture:null, zero-skip qualification guards, and legacy54/55 contracts remain unchanged. Required separate local runs use the actual original: TOEIC via HANQ_TOEIC_FIXTURE_DIR/round-with-checks.prepared.json; opening via HANQ_OPENING_TEST_BUNDLE. No private fixture is copied into Git, the image build context, or Actions artifacts/logs. Raw local failures may contain source text and must remain local; shared summaries contain only counts/hashes/status.

At this source preparation checkpoint, the four relocated original-only cases have NOT yet been executed for this candidate. Deployment additionally requires actual zero-skip local results bound to exact original-input hashes and tested module hashes. Such local results are not GitHub-authenticated qualification receipts.
