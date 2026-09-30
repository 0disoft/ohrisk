# License Evaluation

The release gate uses twenty reviewed held-out cases in
`evaluation/license-heldout.json`. Expected decisions are maintained data;
they must not be regenerated from Ohrisk's current output when a case fails.

Every case declares severity, confidence, SPDX expression, choices, AND/OR
joiner, exceptions, evidence signals, package expression, and bundled component
expressions. Missing semantic expectations fail dataset validation. Exact
matches require all these values to agree. Expression comparison normalizes
parentheses, associative operators, and operand order while preserving AND
versus OR and WITH exceptions. Package and component scopes are assessed
separately and the combined package decision must still match.

The summary separates under-classified risk, over-classified risk, and unknown
decisions deferred for insufficient evidence. A correctly expected unknown may
match exactly and still be counted as deferred; an unexpected unknown fails the
gate. Unknown is not treated as a permissive license or a numeric risk downgrade.
Semantic mismatches are counted independently of risk-direction outcomes.

The fixed corpus retains its original package declarations and adds a scoped
ISC component to the BSD file-only case. Focused tests exercise same-severity
license mistakes, operator and exception changes, scope changes, conflicts,
and unsupported semantic expectations.

External ScanCode and Licensee observations are independent annotations.
`not-run` and errors remain unavailable observations, never evidence of agreement.
Release evaluation does not require downloading or running those tools.
