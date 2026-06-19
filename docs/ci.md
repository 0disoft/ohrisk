# CI Usage Guide

Examples for running Ohrisk in GitHub Actions. These examples assume ohrisk is
published to npm and Bun is available on the runner.

Ohrisk does not provide a dedicated GitHub Action. These examples call the
installed CLI directly in workflow steps.

## Prerequisites

Ohrisk runs on Bun. Set up Bun on the runner and install ohrisk globally:

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun add -g ohrisk
```

Global install is preferred over `bunx ohrisk` in CI because ohrisk runs in
multiple steps. Installing once puts `ohrisk` on PATH for every subsequent step,
and install failures surface before the scan step runs.

## PR gate: fail on high-risk licenses

Block a PR when production-relevant findings meet the `high` threshold:

```yaml
- run: ohrisk ci --prod --fail-on high
```

`--prod` excludes development-only dependencies. `--fail-on high` exits
non-zero when any `high` finding remains after waivers. The default threshold
is `high`; other options are `unknown`, `review`, and `low`.

## Markdown report as an artifact

Generate a Markdown report for PR comments or release notes:

```yaml
- run: ohrisk scan --markdown --prod --output reports/ohrisk.md
- uses: actions/upload-artifact@v4
  with:
    name: ohrisk-markdown
    path: reports/ohrisk.md
```

## SARIF output

Generate a SARIF 2.1.0 file:

```yaml
- run: ohrisk scan --sarif --output reports/ohrisk.sarif
- uses: actions/upload-artifact@v4
  with:
    name: ohrisk-sarif
    path: reports/ohrisk.sarif
```

To upload SARIF to GitHub code scanning, use `github/codeql-action/upload-sarif`
with the `security-events: write` permission. Ohrisk only generates the SARIF
file; the upload step and repository permissions are your responsibility.

## CycloneDX SBOM

Generate a CycloneDX 1.5 JSON SBOM:

```yaml
- run: ohrisk scan --cyclonedx --prod --output reports/ohrisk.cdx.json
- uses: actions/upload-artifact@v4
  with:
    name: ohrisk-sbom
    path: reports/ohrisk.cdx.json
```

## Raw audit without waivers

Run a clean audit that ignores local `.ohrisk-waivers.json` files:

```yaml
- run: ohrisk ci --no-waivers --fail-on high
```

`--no-waivers` skips waiver reading and application entirely. It cannot be
combined with `--strict-waivers`.

## Strict waiver drift check

Fail CI when local waivers are expired or no longer match a finding:

```yaml
- run: ohrisk ci --strict-waivers
```

`--strict-waivers` exits non-zero when expired or unmatched waivers are present,
even if active findings stay below the `--fail-on` threshold.

## Profile selection

Pick the profile that matches how the dependency reaches users:

```yaml
# SaaS — you run the service, no redistribution
- run: ohrisk ci --prod --profile saas --fail-on high

# Distributed app — you ship binaries to users
- run: ohrisk ci --prod --profile distributed-app --fail-on high
```

The default profile is `saas`.

## Multiple lockfiles

When a project has more than one supported lockfile, select one explicitly:

```yaml
- run: ohrisk ci --lockfile package-lock.json --fail-on high
```

## Boundary

Ohrisk is a risk decision aid, not legal advice. It does not guarantee that all
risks are detected or provide a legal verdict. CI gates based on Ohrisk findings
help surface license evidence early; they do not replace legal review.
