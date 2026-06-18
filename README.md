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

- Bun `bun.lock` project discovery
- direct and transitive dependency graph extraction
- production and development dependency classification
- local `file:` package artifact evidence
- remote HTTP(S) package tarball evidence when the lockfile points to a tarball
- gzipped package tarball evidence
- `package.json` license fields
- common `LICENSE`, `LICENCE`, `COPYING`, and `NOTICE` files
- SPDX-like license expression parsing
- profile-aware risk evaluation for `saas` and `distributed-app`
- terminal and JSON reports

Registry metadata resolution, PR diff mode, SARIF, SBOM export, waiver
workflows, GitHub App checks, and multi-ecosystem adapters are not part of this
slice yet.

## Usage

Install globally after the package is published:

```bash
bun add -g ohrisk
```

Run a local scan from a supported project:

```bash
bun run src/cli/main.ts scan
```

Pick the usage profile:

```bash
bun run src/cli/main.ts scan --profile saas
bun run src/cli/main.ts scan --profile distributed-app
```

Limit the scan to production dependencies:

```bash
bun run src/cli/main.ts scan --prod
```

Print machine-readable output:

```bash
bun run src/cli/main.ts scan --json
```

Print the package version:

```bash
bun run src/cli/main.ts --version
```

Once installed as a package, the intended command shape is:

```bash
ohrisk scan --profile saas --prod
ohrisk --version
```

## Report Shape

The terminal report is designed to show the highest-risk findings first:

```text
Ohrisk scan
Profile: saas
Production only: yes
Risks: 1 high, 1 review, 1 unknown, 2 low

Findings:
- [high] agpl-child@0.1.0
  recommendation: replace
  path: fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0
  evidence: license: AGPL-3.0-only; dependency: production; transitive dependency
```

JSON output reuses the same finding model:

```json
{
  "status": "profile_risk_evaluated",
  "profile": "saas",
  "prodOnly": true,
  "findings": [
    {
      "packageId": "agpl-child@0.1.0",
      "severity": "high",
      "recommendation": "replace",
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

## Risk Language

Ohrisk intentionally avoids legal `safe` or `unsafe` verdicts.

- `low`: known low-risk license expression for the selected profile
- `review`: review before shipping under the selected profile
- `high`: replace or escalate before shipping under the selected profile
- `unknown`: missing, malformed, or unrecognized license evidence

For example, GPL is treated differently for `saas` and `distributed-app`
because redistribution changes the risk profile.

## Development

Run the test suite:

```bash
bun test
```

Run the fixture scan manually:

```bash
cd test/fixtures/bun-project
bun run ../../../src/cli/main.ts scan --profile saas
```
