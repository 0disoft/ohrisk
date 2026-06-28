# CI Usage Guide

Examples for running Ohrisk in GitHub Actions.

## Dedicated action

Use the dedicated action when you want the shortest PR gate:

```yaml
- uses: 0disoft/ohrisk@v0.160.13
  with:
    prod: "true"
    fail-on: high
```

The action installs the published npm package, runs `ohrisk ci` by default, and
fails the step when findings meet the configured threshold. Pin the action tag
for reproducible CI.

Generate an HTML report artifact:

```yaml
- uses: 0disoft/ohrisk@v0.160.13
  with:
    command: scan
    format: html
    output: reports/ohrisk.html
    prod: "true"
    fail-on: ""

- uses: actions/upload-artifact@v4
  with:
    name: ohrisk-html
    path: reports/ohrisk.html
```

The `output` and `lockfile` inputs must be repository-relative paths. Absolute
paths, Windows drive paths, UNC paths, and `..` segments are rejected before
the CLI runs.

## Direct CLI steps

The examples below call the installed CLI directly. Use them when you need more
control than the composite action exposes.

## Prerequisites

The packaged Ohrisk CLI runs on Node.js. Set up Node on the runner and install
ohrisk globally:

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 24
- run: npm install -g ohrisk
```

Global install is preferred when ohrisk runs in multiple steps. Installing once
puts `ohrisk` on PATH for every subsequent step, and install failures surface
before the scan step runs. For a single-step gate, `npx`, `pnpm dlx`, `yarn dlx`,
or `bunx` are also fine.

For a stable CI gate, pin the version instead of tracking latest:

```yaml
- run: npm install -g ohrisk@<version>
```

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
- run: ohrisk ci --lockfile npm-shrinkwrap.json --fail-on high
- run: ohrisk ci --lockfile deno.lock --fail-on high
```

For Deno projects, Ohrisk currently scans npm package dependencies recorded in
`deno.lock`. Remote URL imports and JSR packages are not scanned yet.

## Boundary

Ohrisk is a risk decision aid, not legal advice. It does not guarantee that all
risks are detected or provide a legal verdict. CI gates based on Ohrisk findings
help surface license evidence early; they do not replace legal review.
