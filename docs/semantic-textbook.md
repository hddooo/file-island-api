# Member-only semantic textbook bundle

The source is the user-provided 144-page PDF, 35,449,421 bytes, SHA256 `35d850c6e9d9910c24cccce4b2ae37b963ee1ecd24f1926033f48d98f9de0442`. The local renamed file was verified against this exact digest. No 25-page substitute is used.

The bundle contains 104 semantic source pages (94 body/appendix pages plus 10 front-matter/divider/publication pages), 642 original blank questions, and 24 verified four-choice practices. These counts do not mean all 144 PDF pages have passed fidelity review.

## Figures and source coverage

183 small source map/photo/illustration assets are manifest-listed (14,660,933 bytes total). Previously connected text rasters and decorative characters were retired as described below. JPEG bytes are preserved directly. Where an embedded image has a soft mask, its source pixels and mask are combined into PNG. No full-page render or original PDF is shipped.

`textbook-figure-inventory.json` records all 297 image inventory placements in the 94 body sections, including decorative/cover images that are not figure blocks. Every inventory image is matched to the exact embedded-image SHA256 in the original PDF. It records 183 connected assets, 44 source raster-text placements converted into 39 logical native-text diagrams, 42 decorative characters, 25 excluded cover/page raster placements, 2 approval-held assets, and 1 additional fragment held atomically with an approval-held asset. The original inventory contains 297 image placements; it is not the number of published assets.

`assets/p009-figure-5.jpeg` and `assets/p009-figure-6.jpeg` remain absent. Their bytes are not renamed, converted, or uploaded elsewhere. Figure 4 is also absent because it forms one panel with held figure 5.

PDF18/21/24/26 galleries retain original native caption spans and original visual row/column order. PDF26 figures 2/3 remain an atomic contiguous landscape pair. The original caption text/span multiset was checked before and after these changes. No textbook wording was summarized or silently corrected.

`textbook-page-coverage.json` records all 144 PDF pages, body JSON presence, quiz presence, tables, figure counts and unresolved figure IDs. It is a structural inventory, not a certificate of full text/table/visual fidelity. Front matter and exercise pages do not become body sections solely to inflate coverage.

## Access and validation

All `/api/v1/textbook/semantic/*` routes retain JWT/live-session and member guards. Anonymous and revoked sessions are denied. Responses remain `private, no-store`; no static source directory is mounted. No production account, exam submission, or wrong-answer record was changed for QA.

Mac checks: TypeScript typecheck; 12 isolated textbook API tests passed with `TMPDIR=/private/tmp` (macOS `/var` symlink normalization is required by existing temporary-path fixtures); `node scripts/check-textbook-bundle.cjs` validates 104 pages, all 183 asset digests/sizes/MIME signatures, absence of held assets and absence of unlisted files. Run `python scripts/inventory-textbook-figures.py /path/to/approved.pdf` to reproduce source inventories; requires PyMuPDF.

Offline Chromium QA covers all 104 actual semantic source pages at 390px and 1440px. It does not prove live login, deployment, physical-device behavior, or complete PDF fidelity. Those remain separate checks.

## Source diagram completion pass

44 raster-text placements now render as 39 logical diagrams with native text, actual table spans, explicit branch metadata, source range bars and source-positioned timeline ticks/bands. The original 94 pages retain their exact native-source span multisets. PDF8/16 era guidance and PDF1–7/144 front matter/publication text were added without page images. The union of 104 semantic pages and 41 original exercise-source pages is all 144 PDF pages (PDF37 is shared). This union is structural coverage; it is not a claim of pixel-identical page reproduction.

The source-geometry/source-caption tests check each transcript renders exactly once, retired text rasters are absent from the manifest, source-cell embeddings remain intact and invalid timeline ranges fail closed. `docs/textbook-diagram-review.json` lists the 39 diagrams and their 44 source placements. `scripts/transcribe-textbook-diagrams.py` contains the reviewed text/relationship data and source image digests. Full original PDF pages remain local only.

Author wording and historical assertions were retained, including source timeline dates and selections; no historical correction or summarization was applied. The approval-held figures remain the only intentionally unserved instructional source-image exceptions. Four-choice practice remains 24 verified questions; it has not been represented as complete.


### Reviewed illustration layout repair

`repair-textbook-figure-layout.py` is the follow-up layout step after the prior source extract/transcription, based on enlarged original PDF review. It conserves every native source span, moves allowed existing figure IDs into their original row/column relationships, and keeps raster-only diagram labels as native caption text. The added illustration column is an explicit semantic envelope for a source image overlaid across multiple text rows, not a claim of an extra printed border. Native table row merges and nested labels remain intact. No quiz payload, held asset, source text or image bytes change.
