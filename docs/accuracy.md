# Accuracy Evidence

Ohrisk keeps a reviewed, category-sharded license-decision corpus under
`test/fixtures/license-gold/*.json`. Each case records a public source, the
expected decision, and the rationale for that expectation. The release test
rejects duplicate case IDs and evaluates the same normalizer and policy path
used by the CLI.

## Current pinned baseline

| Metric | Result |
| --- | --- |
| Exact severity and confidence matches | 65/65 |
| Expected high-risk cases classified high | 17/17 |
| Expected non-high cases incorrectly classified high | 0/48 |
| Expected unknown cases classified unknown | 18/18 |

This is a small regression corpus and is not statistically representative of
package registries, real repositories, or all license text. In particular,
`17/17` is a test result with a denominator of seventeen, not a general high-risk
recall claim. It must not be presented as evidence that Ohrisk has zero false
negatives in production.

The current adversarial shard includes incomplete or materially altered license
text, duplicate and distinct legal files, NOTICE bundles, and contradictory
metadata/file claims. A title and version line alone is not treated as a full
license-text match; an explicit `SPDX-License-Identifier` remains a declaration.
The npm and PyPI registry shard records verified-artifact precedence over
registry-only license claims, PyPI distribution-scoped `License-Expression`,
deprecated classifier confidence, and npm legacy metadata compatibility.

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
