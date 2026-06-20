# Ohrisk

Ohrisk catches open-source license risk before your PR ships.

It is a local CLI for developers who need a quick answer to questions like:

- Did this dependency bring in AGPL, GPL, BUSL, or unknown license evidence?
- Is the risky package production-relevant or dev-only?
- Which parent package introduced the transitive risk?
- Does the answer change for SaaS versus distributed app usage?

Ohrisk is a risk decision aid, not legal advice. It reports `low`, `review`,
`high`, and `unknown` findings for the selected usage profile.

## When to use it

Run Ohrisk when you are about to add or upgrade a dependency and want a fast,
local read on whether the license evidence introduces risk for your shipping
model. It sits between "I just installed a package" and "legal review."

- before opening a PR that adds or changes dependencies
- before cutting a release or tagging a build
- when a transitive dependency surprise appears in a lockfile diff
- when you need a SARIF or SBOM artifact for a compliance pipeline

Ohrisk does not approve or block packages on its own. It gives you the
evidence and a profile-aware severity so you can decide.

## Commands

| Command | What it answers |
| --- | --- |
| `ohrisk scan` | What does my dependency tree look like right now? Non-failing local decision aid. |
| `ohrisk ci` | Should this PR fail the build? Runs a scan and exits non-zero when findings meet `--fail-on`. |
| `ohrisk diff <ref>` | What changed since the baseline git ref? Surfaces only new or meaningfully changed findings. |
| `ohrisk explain <expr>` | How would Ohrisk classify this license expression for a profile, without scanning a project? |

## Usage profiles

Ohrisk evaluates the same dependency tree differently depending on how you ship
software, because redistribution changes license obligations.

- `saas` (default): you run the service and do not redistribute the package
  binaries to users. GPL-only copyleft such as GPL-2.0 and GPL-3.0 is treated
  as `review` rather than an immediate block, because SaaS usage does not
  trigger redistribution obligations. AGPL and source-available restrictions
  remain `high`.
- `distributed-app`: you ship the package to users. GPL becomes `high` because
  redistribution obligations apply. Weak copyleft (LGPL, MPL, EPL) is flagged as
  `review`.

Pick the profile that matches how the dependency reaches your users:

```bash
ohrisk scan --profile saas
ohrisk scan --profile distributed-app
```

## Runtime

Ohrisk is distributed as an npm package, and the packaged CLI runs on Node.js
`>=20.0.0`. Bun is used for Ohrisk development, tests, and packaging, but users
do not need Bun installed to run the published CLI.

Ohrisk scans Bun, npm package-lock/shrinkwrap, pnpm, Deno npm, and Yarn
lockfiles regardless of which package manager you use to install the CLI.

## Current Scope

The current implementation is the first npm-style vertical slice:

- Bun `bun.lock`, npm `package-lock.json`, npm `npm-shrinkwrap.json`, pnpm `pnpm-lock.yaml`, Deno `deno.lock`, and Yarn classic/Berry `yarn.lock` project discovery
- Node-compatible packaged CLI entrypoint for npm, pnpm, Yarn, npx, pnpm dlx, and yarn dlx users
- explicit lockfile selection with `--lockfile <path>` for projects that contain more than one supported lockfile
- direct and transitive dependency graph extraction
- Bun, npm, pnpm, and Yarn classic/Berry workspace projects are scanned from every workspace/importer package root
- pnpm `catalog:` and `catalog:<name>` dependency specifiers are resolved from `pnpm-workspace.yaml`
- Deno `deno.lock` projects are scanned for npm package dependencies recorded in `npm:` specifiers; remote URL imports and JSR packages are not scanned yet
- npm alias dependency resolution, including pnpm alias package keys, with alias context preserved in dependency paths
- production, development, optional, and peer dependency classification
- local `file:` package artifact evidence
- installed `node_modules` package evidence, including npm alias install names, before network fallback
- Yarn Berry `.yarn/cache` package zip evidence before registry fallback for PnP installs without `node_modules`
- remote HTTP(S) package tarball evidence when the lockfile points to a tarball, with credential-bearing URLs, obvious local, private, special-purpose, and DNS-resolved internal hosts blocked before fetch, DNS answers rechecked at the default connection boundary, and redirects followed only after each target is validated
- lockfile integrity verification for local and remote package tarballs
- npm registry metadata lookup when the lockfile does not include a direct tarball URL
- gzipped package tarball evidence
- `package.json` license fields
- common root-level `LICENSE`, `LICENCE`, `UNLICENSE`, `COPYING`, and `NOTICE` file variants
- medium-confidence standard license detection from recognizable `LICENSE` and `COPYING` file text, including SPDX identifiers, GPL-family v2/v3 text, Zlib text, public-domain-style text, and malformed metadata pointers
- SPDX-like license expression parsing
- common human-readable license metadata alias normalization, including slash and comma dual-license shorthands
- low-risk classification for common permissive, Zlib, and public-domain-style SPDX licenses
- NOTICE evidence is surfaced as attribution-preservation action text without raising severity
- high-risk classification for common source-available restriction licenses
- explicit commercial restriction text detection in license evidence and package metadata
- profile-aware risk evaluation for `saas` and `distributed-app`
- terminal and JSON reports
- SARIF 2.1.0 reports for code scanning upload
- waived findings in SARIF output as externally suppressed results
- Markdown reports for PR comments and release notes
- CycloneDX 1.5 JSON SBOM reports with dependency relationships and Ohrisk risk decision properties
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
npm install -g ohrisk
pnpm add -g ohrisk
yarn global add ohrisk
bun add -g ohrisk
```

Run once without a global install:

```bash
npx ohrisk scan
pnpm dlx ohrisk scan
yarn dlx ohrisk scan
bunx ohrisk scan
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
- `npm-shrinkwrap.json` with the same package-lock parser support
- `pnpm-lock.yaml` with `importers`, `packages`, and `snapshots` sections, including default and named catalogs from `pnpm-workspace.yaml`
- `deno.lock` npm package entries from Deno v3/v4-style lockfiles
- Yarn classic/Berry `yarn.lock` with root and workspace dependency sets from `package.json` manifests, plus local `.yarn/cache` zip evidence for Berry/PnP installs

Select a specific lockfile when a project contains more than one supported lockfile:

```bash
ohrisk scan --lockfile package-lock.json
ohrisk scan --lockfile npm-shrinkwrap.json
ohrisk ci --lockfile pnpm-lock.yaml --fail-on high
ohrisk scan --lockfile deno.lock
ohrisk diff main --lockfile bun.lock
```

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
      "expiresOn": "2026-09-30"
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
ohrisk scan --lockfile package-lock.json
ohrisk scan --lockfile npm-shrinkwrap.json
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

## Documentation

- [Documentation Index](https://github.com/0disoft/ohrisk/blob/main/docs/README.md) — All guides in one place
- [CI Usage Guide](https://github.com/0disoft/ohrisk/blob/main/docs/ci.md) — GitHub Actions examples for PR gates and artifacts
- [Waiver Guide](https://github.com/0disoft/ohrisk/blob/main/docs/waivers.md) — Managing license risk waivers safely
- [Profile Guide](https://github.com/0disoft/ohrisk/blob/main/docs/profiles.md) — Choosing between saas and distributed-app
- [Report Formats Guide](https://github.com/0disoft/ohrisk/blob/main/docs/report-formats.md) — What each output format includes
- [한국어 사용 가이드](https://github.com/0disoft/ohrisk/blob/main/docs/ko/README.md) — Korean usage guide for developers
