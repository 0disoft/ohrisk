# HTML Report Design QA

## Evidence

- Source visual truth: `%CODEX_HOME%/generated_images/019f6924-8a9c-7b20-983a-3c5f175577f9/exec-77075742-848e-47f6-9caf-03f62fb04da9.png`
- User refinement source: `%TEMP%/codex-clipboard-ff81a098-b06d-449f-a24a-3c76117e6eed.png`
- Desktop implementation: `.tmp/design-qa/implementation-findings-v5.png`
- Focused findings implementation: `.tmp/design-qa/implementation-findings-v5.png`
- Mobile implementation: `.tmp/design-qa/implementation-mobile-v4.png`
- Desktop viewport and pixels: 1536 x 1024 CSS px, 1536 x 1024 image px, device density 1.
- Mobile viewport and pixels: 390 x 844 CSS px, 390 x 844 image px, device density 1.
- State: Korean, SaaS profile, Bloxstrap scan with 9 unknown findings and partial repository coverage.

## Full-view comparison

The implementation preserves the selected concept's dark navigation rail, restrained blue accent, compact severity summary, white bordered surfaces, and findings-first review hierarchy. The standalone-report constraint intentionally keeps the decision and scan summary above the findings console instead of reproducing the mock's repository and branch toolbar. Typography uses the existing system stack, with weight and scale matching the reference hierarchy. Spacing, radii, borders, colors, and semantic severity treatments are consistent. No image assets are present in either the implemented report surface or its product requirements.

## Focused findings comparison

The findings region keeps the reference's list-and-inspector relationship while removing redundant content: filters sit directly above the workspace, each selectable card shows only `name@version`, one row is visibly selected, the list scrolls independently on desktop, and all severity and explanatory fields appear once in the adjacent sticky inspector. Copy remains generated from localized report data.

## Findings

- No actionable P0, P1, or P2 differences remain.
- P3 follow-up: a future application-backed report could add the reference concept's column sorting and export controls, but those are outside this standalone static HTML redesign.

## Comparison history

1. Initial implementation: review and scan summary cards occupied two full rows, pushing the findings controls below the first viewport. Fixed by keeping four primary review cards visible and moving secondary review context and the full scan summary into native collapsed disclosures. Post-fix evidence: `implementation-desktop-v3.png`.
2. Focused findings review: source detail rows were visible inside the list because a later grid rule overrode the hidden-source rule. Fixed with a more specific hidden-source selector and verified computed `display: none`. Post-fix evidence: `implementation-desktop-v4.png` and `implementation-findings-v4.png`.
3. Mobile review: the horizontally scrollable navigation exposed a persistent platform scrollbar. Fixed by retaining keyboard/touch scrolling while hiding only the visual scrollbar. Post-fix evidence: `implementation-mobile-v4.png`.
4. User review: the left selection card repeated severity, dependency, reason, action, path, and evidence already shown in the inspector. Reduced each card to the package identity only while preserving hidden searchable source data and native button semantics. Post-fix evidence: `implementation-findings-v5.png`.

## Interaction and accessibility checks

- Selected a second finding and confirmed `aria-pressed` plus inspector content updated.
- Searched for `Markdig` and confirmed one visible result and synchronized status text.
- Confirmed the left selection button exposes exactly one visible child and only the package identity as its text.
- Confirmed hidden source details compute to `display: none`.
- Confirmed no duplicate document IDs after inspector cloning.
- Confirmed no desktop or mobile page-level horizontal overflow.
- Confirmed the 390 px layout collapses the workspace to one column and removes sticky sidebar behavior.
- Checked browser console warnings and errors: none.

## Final result

final result: passed
