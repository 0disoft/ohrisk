# Waiver Guide

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

Each waiver requires at least one of `id` or `fingerprint`, plus a non-empty
`reason`. The `expiresOn` field is optional but recommended.

The file contract is closed: the root accepts only `waivers`, and each waiver
accepts only `id`, `fingerprint`, `reason`, and `expiresOn`. Unknown fields are
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

A finding's `fingerprint` extends the `id` with severity, recommendation,
reason, and evidence:

```
id::severity::recommendation::reason::evidence
```

The `id` prefix remains readable for ordinary package names. Fingerprint suffix
components such as reason and evidence are percent-escaped when they contain
finding delimiters, so exact fingerprint waivers do not collide.

Waiving by `fingerprint` matches only when the finding is exactly the same. If
the finding's severity, reason, or evidence changes — for example, because
license detection improved — the waiver stops matching and the finding becomes
active again. Use this when you want the waiver to break on any finding change:

```json
{
  "fingerprint": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only|dependency: production|transitive dependency",
  "reason": "Accepted for this release after internal review.",
  "expiresOn": "2026-09-30"
}
```

If both `id` and `fingerprint` are present, a finding matching either one is
waived. The `matchedBy` field in the report records which field matched, with
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
