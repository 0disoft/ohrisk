# Ohrisk

Ohrisk catches open-source license risk before your PR ships.

It is a local CLI for developers who need a quick answer to questions like:

- Did this dependency bring in AGPL, GPL, BUSL, or unknown license evidence?
- Is the risky package production-relevant or dev-only?
- Which parent package introduced the transitive risk?
- Does the answer change for SaaS versus distributed app usage?

Ohrisk is a risk decision aid, not legal advice. It reports `low`, `review`,
`high`, and `unknown` findings for the selected usage profile.

## Runtime

Ohrisk is distributed as an npm package, but the CLI runs on Bun. Make sure
`bun` is available on your `PATH` before running the installed `ohrisk` command.

## Current Scope

The current implementation is the first npm-style vertical slice:

- Bun `bun.lock`, npm `package-lock.json`, pnpm `pnpm-lock.yaml`, and Yarn v1 `yarn.lock` project discovery
- direct and transitive dependency graph extraction
- npm alias dependency resolution, including pnpm alias package keys, with alias context preserved in dependency paths
- production and development dependency classification
- local `file:` package artifact evidence
- installed `node_modules` package evidence, including npm alias install names, before network fallback
- remote HTTP(S) package tarball evidence when the lockfile points to a tarball
- lockfile integrity verification for local and remote package tarballs
- npm registry metadata lookup when the lockfile does not include a direct tarball URL
- gzipped package tarball evidence
- `package.json` license fields
- common `LICENSE`, `LICENCE`, `UNLICENSE`, `COPYING`, and `NOTICE` file variants
- medium-confidence standard license detection from recognizable `LICENSE` and `COPYING` file text, including GPL-family v2/v3 text, Zlib text, public-domain-style text, and malformed metadata pointers
- SPDX-like license expression parsing
- common human-readable license metadata alias normalization
- low-risk classification for common permissive, Zlib, and public-domain-style SPDX licenses
- NOTICE evidence is surfaced as attribution-preservation action text without raising severity
- high-risk classification for common source-available restriction licenses
- explicit commercial restriction text detection in license evidence and package metadata
- profile-aware risk evaluation for `saas` and `distributed-app`
- terminal and JSON reports
- SARIF 2.1.0 reports for code scanning upload
- waived findings in SARIF output as externally suppressed results
- Markdown reports for PR comments and release notes
- CycloneDX 1.5 JSON SBOM reports with Ohrisk risk decision properties
- stable finding IDs for PR comments and local waiver workflows
- local `.ohrisk-waivers.json` waivers by finding ID or fingerprint
- stable diff matching that ignores reason and evidence prose churn while surfacing severity, recommendation, and action changes
- exact finding fingerprints for SARIF partial fingerprints and audit trails
- finding fingerprints in terminal and Markdown reports for waiver and audit workflows
- structured dependency type and direct/transitive scope in findings
- report file output with `--output <file>`
- command-specific help with `ohrisk help <command>` and `ohrisk <command> --help`
- standalone license expression explanation
- git ref diff reports that show only new or meaningfully changed findings
- JSON threshold outcomes for `ci --fail-on` and `diff --fail-on`
- terminal and Markdown threshold outcomes for `ci --fail-on` and `diff --fail-on`
- strict CI waiver drift checks for expired or unmatched local waivers
- raw scan and CI mode with `--no-waivers` when waiver files should be ignored
- explicit waiver mode in JSON, terminal, Markdown, and SARIF reports
- explicit waiver mode in CycloneDX SBOM metadata

Central approval workflows, GitHub App checks, and ecosystem adapters beyond
npm-style lockfiles are not part of this slice yet.

## Usage

Install globally after the package is published:

```bash
bun add -g ohrisk
```

Run a local scan from a supported project:

```bash
ohrisk scan
```

Print command help or the installed package version:

```bash
ohrisk help
ohrisk help scan
ohrisk version
```

Supported lockfiles:

- `bun.lock`
- `package-lock.json` with either a modern `packages` section or an npm v1 dependency tree
- `pnpm-lock.yaml` with `importers`, `packages`, and `snapshots` sections
- Yarn v1 `yarn.lock` with the root dependency set from `package.json`

Pick the usage profile:

```bash
ohrisk scan --profile saas
ohrisk scan --profile distributed-app
```

Limit the scan to production-relevant dependencies by excluding development-only packages:

```bash
ohrisk scan --prod
```

Print machine-readable output:

```bash
ohrisk scan --json
```

Print SARIF output for code scanning upload:

```bash
ohrisk scan --sarif
```

Print a Markdown report:

```bash
ohrisk scan --markdown --prod
```

Print a CycloneDX SBOM:

```bash
ohrisk scan --cyclonedx --prod
```

Write a report to a file:

```bash
ohrisk scan --sarif --output reports/ohrisk.sarif
ohrisk scan --cyclonedx --output reports/ohrisk.cdx.json
ohrisk diff main --prod --markdown --output reports/ohrisk-pr.md
```

Fail a local CI step when findings meet a threshold:

```bash
ohrisk ci --fail-on high
```

Fail a local CI step when waiver files contain expired or unmatched waivers:

```bash
ohrisk ci --strict-waivers
```

Run a raw audit scan or CI step without reading local waiver files:

```bash
ohrisk scan --no-waivers
ohrisk ci --no-waivers --fail-on high
```

Waive a finding locally by ID or fingerprint in `.ohrisk-waivers.json`:

```json
{
  "waivers": [
    {
      "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      "reason": "Accepted for this release after internal review.",
      "expiresOn": "2099-12-31"
    }
  ]
}
```

Waived findings are excluded from `ci --fail-on` threshold failures, but scan
and CI JSON, terminal, Markdown, and SARIF reports still show them. Terminal
and Markdown reports include finding fingerprints so waiver files can target
either `id` or `fingerprint`. Expired waivers and unmatched active waivers are
reported separately in JSON, terminal, and Markdown reports and are not applied.
`ci --strict-waivers` exits non-zero when either expired or unmatched waivers
are present, even if active findings stay below the `--fail-on` threshold. JSON,
terminal, Markdown, and SARIF outputs include the strict waiver drift result
when that option is enabled. `scan --no-waivers` and `ci --no-waivers` do not
read or apply local waiver files; `ci --no-waivers` cannot be combined with
`--strict-waivers`. Reports include a waiver mode field or summary line so raw
audits can distinguish ignored waiver files from projects with no waivers.

Explain a license expression without scanning a project:

```bash
ohrisk explain AGPL-3.0-only --profile saas
```

Compare the current findings against a baseline git ref:

```bash
ohrisk diff main --prod
ohrisk diff main --prod --fail-on unknown
ohrisk diff main --prod --markdown
```

Print the package version:

```bash
ohrisk --version
```

Once installed as a package, the intended command shape is:

```bash
ohrisk scan --profile saas --prod
ohrisk ci --fail-on high
ohrisk ci --strict-waivers
ohrisk scan --no-waivers
ohrisk ci --no-waivers --fail-on high
ohrisk scan --sarif
ohrisk scan --markdown --prod
ohrisk scan --cyclonedx --prod
ohrisk scan --sarif --output reports/ohrisk.sarif
ohrisk explain AGPL-3.0-only --profile saas
ohrisk diff main --prod --fail-on unknown
ohrisk --version
```

## Report Shape

The terminal report is designed to show the highest-risk findings first:

```text
Ohrisk scan
Profile: saas
Production only: yes
Risks: 1 high, 1 review, 1 unknown, 2 low
Waiver mode: local (.ohrisk-waivers.json)
Waived: 0 applied, 0 expired, 0 unmatched

Findings:
- [high] agpl-child@0.1.0
  id: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0
  fingerprint: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only|dependency: production|transitive dependency|source: local|package.json license: AGPL-3.0-only|file: COPYING (copying)
  License expression is high risk for saas.
  recommendation: replace
  action: Replace this package or escalate before shipping.
  dependency: production transitive
  path: fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0
  evidence: license: AGPL-3.0-only; dependency: production; transitive dependency; source: local; package.json license: AGPL-3.0-only; file: COPYING (copying)
```

JSON output reuses the same finding model:

```json
{
  "status": "profile_risk_evaluated",
  "profile": "saas",
  "prodOnly": true,
  "waiverMode": "local",
  "nextAction": "Replace or escalate high-risk dependencies before shipping.",
  "failOn": "high",
  "failed": true,
  "failingFindingCount": 1,
  "findings": [
    {
      "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      "fingerprint": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only|dependency: production|transitive dependency",
      "packageId": "agpl-child@0.1.0",
      "severity": "high",
      "reason": "License expression is high risk for saas.",
      "recommendation": "replace",
      "action": "Replace this package or escalate before shipping.",
      "dependencyType": "production",
      "dependencyScope": "transitive",
      "paths": [
        [
          "fixture-bun-project",
          "permissive-parent@1.0.0",
          "agpl-child@0.1.0"
        ]
      ]
    }
  ]
}
```

Markdown output keeps the scan summary and PR-facing decision fields together:

```markdown
- Licenses: `4 high-confidence`, `0 medium-confidence`, `1 low-confidence`
- License issues: `1 missing`, `0 malformed`
- Waiver mode: `local (.ohrisk-waivers.json)`
- Threshold: failed on high (1 finding at or above threshold)

| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0` | `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only\|dependency: production\|transitive dependency\|source: local\|package.json license: AGPL-3.0-only\|file: COPYING (copying)` | high | `agpl-child@0.1.0` | production transitive | License expression is high risk for saas. | replace | Replace this package or escalate before shipping. | fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0 |
```

## Risk Language

Ohrisk intentionally avoids legal `safe` or `unsafe` verdicts.

- `low`: known low-risk license expression for the selected profile
- `review`: review before shipping under the selected profile
- `high`: replace or escalate before shipping under the selected profile, including explicit commercial-use restrictions and packages marked `UNLICENSED`
- `unknown`: missing, malformed, or unrecognized license evidence

For example, GPL is treated differently for `saas` and `distributed-app`
because redistribution changes the risk profile.

## Development

Run the test suite:

```bash
bun test
```

Run the release-ready local gate:

```bash
bun run verify:release
```

Run the fixture scan manually:

```bash
cd test/fixtures/bun-project
bun run ../../../src/cli/main.ts scan --profile saas
```
