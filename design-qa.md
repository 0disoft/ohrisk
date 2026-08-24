# HTML Report Design QA

## Evidence

- Source visual truth: `C:/Users/cherr/.codex/generated_images/019f6924-8a9c-7b20-983a-3c5f175577f9/exec-77075742-848e-47f6-9caf-03f62fb04da9.png`
- Desktop implementation: `C:/Users/cherr/Documents/workspace/zerodi-wd1/projects/hobby/opensource/ohrisk/.tmp/design-qa/implementation-desktop-v4.png`
- Focused findings implementation: `C:/Users/cherr/Documents/workspace/zerodi-wd1/projects/hobby/opensource/ohrisk/.tmp/design-qa/implementation-findings-v4.png`
- Mobile implementation: `C:/Users/cherr/Documents/workspace/zerodi-wd1/projects/hobby/opensource/ohrisk/.tmp/design-qa/implementation-mobile-v4.png`
- Desktop viewport and pixels: 1536 x 1024 CSS px, 1536 x 1024 image px, device density 1.
- Mobile viewport and pixels: 390 x 844 CSS px, 390 x 844 image px, device density 1.
- State: Korean, SaaS profile, Bloxstrap scan with 9 unknown findings and partial repository coverage.

## Full-view comparison

The implementation preserves the selected concept's dark navigation rail, restrained blue accent, compact severity summary, white bordered surfaces, and findings-first review hierarchy. The standalone-report constraint intentionally keeps the decision and scan summary above the findings console instead of reproducing the mock's repository and branch toolbar. Typography uses the existing system stack, with weight and scale matching the reference hierarchy. Spacing, radii, borders, colors, and semantic severity treatments are consistent. No image assets are present in either the implemented report surface or its product requirements.

## Focused findings comparison

The findings region matches the reference's list-and-inspector relationship: filters sit directly above the workspace, one row is visibly selected, the list scrolls independently on desktop, and the detail inspector remains adjacent and sticky. The implementation uses cards rather than a dense table because Ohrisk findings contain long evidence and path text; this is an intentional content constraint, not missing functionality. Copy remains generated from localized report data.

## Findings

- No actionable P0, P1, or P2 differences remain.
- P3 follow-up: a future application-backed report could add the reference concept's column sorting and export controls, but those are outside this standalone static HTML redesign.

## Comparison history

1. Initial implementation: review and scan summary cards occupied two full rows, pushing the findings controls below the first viewport. Fixed by keeping four primary review cards visible and moving secondary review context and the full scan summary into native collapsed disclosures. Post-fix evidence: `implementation-desktop-v3.png`.
2. Focused findings review: source detail rows were visible inside the list because a later grid rule overrode the hidden-source rule. Fixed with a more specific hidden-source selector and verified computed `display: none`. Post-fix evidence: `implementation-desktop-v4.png` and `implementation-findings-v4.png`.
3. Mobile review: the horizontally scrollable navigation exposed a persistent platform scrollbar. Fixed by retaining keyboard/touch scrolling while hiding only the visual scrollbar. Post-fix evidence: `implementation-mobile-v4.png`.

## Interaction and accessibility checks

- Selected a second finding and confirmed `aria-pressed` plus inspector content updated.
- Searched for `Markdig` and confirmed one visible result and synchronized status text.
- Confirmed hidden source details compute to `display: none`.
- Confirmed no duplicate document IDs after inspector cloning.
- Confirmed no desktop or mobile page-level horizontal overflow.
- Confirmed the 390 px layout collapses the workspace to one column and removes sticky sidebar behavior.
- Checked browser console warnings and errors: none.

## Final result

final result: passed
