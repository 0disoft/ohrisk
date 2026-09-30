# Waiver Guide

## Matching a scoped review decision

Scan JSON findings include `decision.id` and `decision.fingerprint`. Their
identity contains the package PURL, usage profile, production-only selection,
and dependency type/directness, independently of explanatory dependency paths.
After reviewing a finding, copy its exact `decision.fingerprint` to the
`decisionFingerprint` field in `.ohrisk-waivers.json`, with a reason and expiry.
This selector survives parent-path changes and ordinary evidence-file renames.
It stops matching when license meaning, confidence, restrictions, or the scoped
usage conditions change. License-only `explain` results do not issue this
project review decision.

If a waiver supplies `decisionFingerprint` together with legacy `id` or
`fingerprint`, only the decision selector is used; the older fields cannot
silently widen its scope. Invalid decision selectors are errors. Reports record
`matchedBy: "decisionFingerprint"`. Existing ID/fingerprint waivers retain their
previous exact path scope and are never automatically converted to decision
waivers. Review before opting into the new matching scope. The packaged waiver
file schema is 1.1 and still accepts files using the older fields.

Waivers let you exclude a specific license risk finding from the CI threshold
without removing it from reports. A waiver records a decision — you accepted
this risk for now — so the finding stays visible while CI stays green.

A waiver does not remove the risk. The finding still appears in terminal, JSON,
Markdown, and SARIF reports, marked as waived. CycloneDX output includes the
`ohrisk:waiverMode` metadata and active finding properties, but does not list
waived findings. Waiving is not a legal judgment. It does not make a package
safe to use or prove compliance.

## Waiver file

Waivers live in `.ohrisk-waivers.json` at the project root:

```json
{
  "waivers": [
    {
      "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      "reason": "Accepted for this release after internal review.",
      "expiresOn": "2026-09-30"
    }
  ]
}
```

Each waiver requires at least one of `id`, `fingerprint`, or `decisionFingerprint`, plus a non-empty
`reason`. The `expiresOn` field is optional but recommended.

The file contract is closed: the root accepts only `waivers`, and each waiver
accepts only `id`, `fingerprint`, `decisionFingerprint`, `reason`, and `expiresOn`. Unknown fields are
rejected instead of ignored, so typos such as `expiresOnn` cannot silently turn
an expiring waiver into a permanent one. The packaged Draft 2020-12 contract is
[`schemas/waiver-file.schema.json`](../schemas/waiver-file.schema.json).

## Matching by id

A finding's `id` is built from the package ID, dependency type, dependency
scope, and dependency paths:

```
packageId::dependencyType::dependencyScope::path1>path2|path3>path4
```

If package IDs or path segments contain finding delimiters such as `::`, `>`,
`|`, or `%`, Ohrisk percent-escapes those characters in the generated `id` so
different dependency paths cannot collapse into the same waiver key.

A scan can change a package ID when Ohrisk disambiguates colliding package
coordinates. Ohrisk keeps a package identifier when it identifies one package
coordinate, but when the same identifier aliases distinct coordinates, such as
an equal name and version in two ecosystems, the package uses its Package URL.
This applies to merged inputs and to a single CycloneDX or SPDX SBOM. A waiver
written against the earlier ambiguous ID no longer matches those findings, so
it is reported as unmatched instead of suppressing both packages. Review the
unmatched waiver and write one waiver per finding ID rather than renewing the
shared ID. With unambiguous identities the original identifier is retained and
existing waivers keep matching.

Waiving by `id` matches any finding for the same package in the same dependency
path, regardless of severity or reason text. Use this when you accept a
package's risk broadly and the finding's severity or evidence may change
between scanner versions:

```json
{
  "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
  "reason": "Accepted for this release after internal review.",
  "expiresOn": "2026-09-30"
}
```

## Matching by fingerprint

A finding's semantic `fingerprint` extends the `id` with severity,
recommendation, and normalized license facts:

```
id::severity::recommendation::escaped-semantic-license-json
```

The facts include the expression, choices, AND/OR joiner, signals, confidence,
exceptions, and decision-relevant evidence facts. File names and metadata-source
labels are provenance, so renaming LICENSE to COPYING alone does not invalidate
a review. Restriction scope, bundled component licenses, conflicts, warnings,
private-package flags, and deprecated SPDX identifiers remain review-relevant.
Conflicting annotations are retained conservatively, including their locations.
Fingerprint components are percent-escaped.

Waiving by `fingerprint` matches the same license decision. Changes in severity,
recommendation, license meaning, confidence, or retained evidence facts require
review. Recognized older semantic fingerprints use the same provenance
normalization in waivers, diffs, and baselines. Opaque older reason/evidence
fingerprints retain exact legacy matching; this example shows that older format.
IDs still include dependency paths; changing the path set requires review:

```json
{
  "fingerprint": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only|dependency: production|transitive dependency",
  "reason": "Accepted for this release after internal review.",
  "expiresOn": "2026-09-30"
}
```

If both `id` and `fingerprint` are present, a finding matching either one is
waived when `decisionFingerprint` is absent. The `matchedBy` field records which field matched, with
`id` taking priority in the label.

## expiresOn

Set `expiresOn` to an ISO date (`YYYY-MM-DD`). The waiver is valid through the
end of that day in UTC. A waiver without `expiresOn` never expires.

Short expiry dates are recommended. Tie the waiver to a release or review
window so stale waivers surface naturally:

```json
{
  "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
  "reason": "Accepted for this release after internal review.",
  "expiresOn": "2026-09-30"
}
```

## Expired waivers

When a waiver expires, it stops matching findings. The finding returns to the
active set and counts toward the CI threshold again. The expired waiver is
reported in the `expiredWaivers` array of JSON output and in Markdown reports.
SARIF output summarizes expired and unmatched waivers as count properties
(`ohriskExpiredWaiverCount`, `ohriskUnmatchedWaiverCount`) rather than listing
individual waiver objects.

By default, expired waivers do not affect the exit code — they are reported
only. Use `--strict-waivers` to fail CI when any expired waiver is present.

## Unmatched waivers

An active waiver that does not match any current finding is an unmatched
waiver. This happens when a package is removed, upgraded, or its finding
changed. The report lists unmatched waivers so you can clean up stale entries.

By default, unmatched waivers do not affect the exit code — they are reported
only. Use `--strict-waivers` to fail CI when any unmatched waiver is present.

## ci --strict-waivers

Fail CI when expired or unmatched waivers are present:

```bash
ohrisk ci --strict-waivers
```

`--strict-waivers` exits non-zero when `expiredWaivers` or `unmatchedWaivers`
is non-empty, even if active findings stay below the `--fail-on` threshold.
This catches waiver drift: a waiver that no longer matches a finding, or one
that expired and was never renewed.

## --no-waivers

Skip waiver reading entirely. All findings are active and count toward the CI
threshold. Use this for a raw audit:

```bash
ohrisk ci --no-waivers --fail-on high
```

`--no-waivers` cannot be combined with `--strict-waivers`.

## Operational principle

Do not use waivers to permanently exempt high-risk packages. A waiver without
`expiresOn` or with a far-future date hides risk indefinitely. Instead:

- Set a short `expiresOn` tied to a release or review window.
- Prefer replacing or isolating the package over waiving it.
- Use `--strict-waivers` in CI so expired and unmatched waivers fail loudly.
- Review waived findings before each release.

Waivers are a decision record. They help you ship with eyes open, not blind.
