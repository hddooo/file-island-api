# Exact source answer normalization

The source workspace/v1 progress graders accept representation differences only in original numbered sequence questions and unordered multi-item answers. Source data, hashes, schema and prior responses are unchanged.

Sequence labels normalize circled 1–20 to numeric tokens. All-single-digit sequences accept compact decimal input; multi-digit label sets require explicit separators or circled glyphs, preventing guessed decimal splits. Token order and count must equal the canonical source.

Unordered multi-answers compare exact canonical items, separated by comma or an unambiguous whitespace partition. No fuzzy aliases, punctuation erasure, duplicate counting or extra items. A subset such as `동예` for `옥저, 동예` is false in saved results; the front can show canonical missing-item details without awarding correctness.

Regression cases: PDF14/printed7 source(1) `p014:gojoseon-and-states:1` (`4132`); PDF15/printed8 source(11) `p015:gojoseon-and-states:11` (`동예`, `동예,옥저`, `옥저 동예`). Tests cover both and front/server differential parity, all14 sequence sources and existing642 canonical answers. No production records are rewritten. Previously stored decimal sequence or whitespace-list responses require explicit member resubmission to update their stored verdict; no affected-user count was collected from operating data.
