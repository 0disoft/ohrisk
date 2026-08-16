# Accuracy Evidence

Ohrisk keeps a reviewed, category-sharded license-decision corpus under
`test/fixtures/license-gold/*.json`. Each case records a public source, the
expected decision, and the rationale for that expectation. The release test
rejects duplicate case IDs and evaluates the same normalizer and policy path
used by the CLI.

## Current pinned baseline

| Metric | Result |
| --- | --- |
| Exact severity and confidence matches | 50/50 |
| Expected high-risk cases classified high | 13/13 |
| Expected non-high cases incorrectly classified high | 0/37 |
| Expected unknown cases classified unknown | 15/15 |

This is a small regression corpus and is not statistically representative of
package registries, real repositories, or all license text. In particular,
`13/13` is a test result with a denominator of thirteen, not a general high-risk
recall claim. It must not be presented as evidence that Ohrisk has zero false
negatives in production.

The current adversarial shard includes incomplete or materially altered license
text, duplicate and distinct legal files, NOTICE bundles, and contradictory
metadata/file claims. A title and version line alone is not treated as a full
license-text match; an explicit `SPDX-License-Identifier` remains a declaration.

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
