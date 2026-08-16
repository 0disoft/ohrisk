# Accuracy Evidence

Ohrisk keeps a reviewed, category-sharded license-decision corpus under
`test/fixtures/license-gold/*.json`. Each case records a public source, the
expected decision, and the rationale for that expectation. The release test
rejects duplicate case IDs and evaluates the same normalizer and policy path
used by the CLI.

## Current pinned baseline

| Metric | Result |
| --- | --- |
| Exact severity and confidence matches | 80/80 |
| Expected high-risk cases classified high | 23/23 |
| Expected non-high cases incorrectly classified high | 0/57 |
| Expected unknown cases classified unknown | 22/22 |

This is a small regression corpus and is not statistically representative of
package registries, real repositories, or all license text. In particular,
`23/23` is a test result with a denominator of twenty-three, not a general high-risk
recall claim. It must not be presented as evidence that Ohrisk has zero false
negatives in production.

The current adversarial shard includes incomplete or materially altered license
text, duplicate and distinct legal files, NOTICE bundles, and contradictory
metadata/file claims. A title and version line alone is not treated as a full
license-text match; an explicit `SPDX-License-Identifier` remains a declaration.
The npm and PyPI registry shard records verified-artifact precedence over
registry-only license claims, PyPI distribution-scoped `License-Expression`,
deprecated classifier confidence, and npm legacy metadata compatibility.
The Maven and Cargo shard covers free-form Maven POM names, POM and verified-JAR
conflicts, inherited claims, Cargo SPDX expression semantics, custom
`license-file` terms, and manifest/file conflicts inside checksum-verified crates.

## Expansion rules

New cases should use public, reviewable evidence and explain why the expected
profile decision follows. The corpus should grow across active and deprecated
SPDX identifiers, exceptions, AND/OR expressions, source-available terms,
custom licenses, conflicting metadata and files, truncated or mutated text,
multiple legal files, and registry-specific anomalies.

Future published accuracy claims require a larger independently reviewed set,
held-out cases, explicit sampling, and disagreement reports against other
tools. A difference from another scanner is evidence to investigate, not proof
that either tool is correct.

## Held-out release evaluation

The 20-case set in `evaluation/license-heldout.json` is separate from the
80-case tuning corpus and is evaluated only by `bun run eval:heldout`, which is
part of release verification. It produces a Markdown decision and tool-
disagreement report. ScanCode and Licensee observations remain explicitly
`not-run` until those exact tools and versions are executed independently;
missing observations are never counted as agreement.
