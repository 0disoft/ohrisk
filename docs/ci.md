# CI Usage Guide

Examples for running Ohrisk in GitHub Actions.

## Dedicated action

Use the tagged action for a reproducible PR gate:

```yaml
- uses: 0disoft/ohrisk@v1.5.0
  with:
    prod: "true"
    fail-on: high
```

The action release contains its own bundled `ohrisk` CLI, so it never resolves
an npm version at workflow runtime. The optional `version` input accepts only an
exact semantic version and asserts that the bundle contains that version:

```yaml
- uses: 0disoft/ohrisk@v1.5.0
  with:
    version: 1.5.0
```

Mutable npm tags, Git URLs, local paths, and version ranges are rejected. A
version that differs from the bundled CLI is rejected as well.

The action's `fail-on` input is empty by default. With the default `command: ci`,
the action forwards no threshold flag and the CLI keeps its own `high` default.
With `command: scan`, the same empty default avoids passing an unsupported
threshold.

Generate an HTML report artifact:

```yaml
- uses: 0disoft/ohrisk@v1.5.0
  with:
    command: scan
    format: html
    output: reports/ohrisk.html
    prod: "true"

- uses: actions/upload-artifact@v7
  with:
    name: ohrisk-html
    path: reports/ohrisk.html
```

The `output`, `lockfile`, `policy`, and `cache-dir` inputs must be
repository-relative paths. Absolute paths, Windows drive paths, UNC paths,
empty path segments, `.` segments, and `..` segments are rejected before the
CLI runs.

Compare a pull request against a baseline ref with the bundled action:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0

- uses: 0disoft/ohrisk@v1.5.0
  with:
    command: diff
    baseline-ref: origin/main
    prod: "true"
    fail-on: high
```

`baseline-ref` is required for `command: diff` and is rejected for `scan` and
`ci`. Ohrisk passes it as one argument without shell re-parsing. The action does
not fetch Git history: the caller must choose an `actions/checkout` history
depth or fetch strategy that makes the baseline ref available. `fetch-depth: 0`
is the simplest general-purpose choice.

## Direct CLI steps

The packaged CLI runs on Node.js. Pin the package version when installing it in
CI:

```yaml
- uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
  with:
    node-version: 24
- run: npm install -g ohrisk@1.5.0
```

A global install is useful when several steps invoke Ohrisk. For one command,
`npx ohrisk@1.5.0`, `pnpm dlx ohrisk@1.5.0`, or an equivalent exact-version
runner also works.

## PR gate

Block a PR when production-relevant findings meet the `high` threshold:

```yaml
- run: ohrisk ci --prod --fail-on high
```

`--prod` excludes development-only dependencies. The default threshold is
`high`; the other thresholds are `unknown`, `review`, and `low`.

## Organization policy

Commit `.ohrisk.yml` at the project root or pass a repository-relative policy
file explicitly:

```yaml
- uses: 0disoft/ohrisk@v1.5.0
  with:
    policy: compliance/ohrisk.yml
    prod: "true"
```

Policy files can inherit other local policy files, define license allow and
deny sets, override severities, apply PURL package rules, customize profiles,
and configure permitted registry hosts. See [Policy Configuration](policy.md).

## Multiple lockfiles

Scan every supported lockfile discovered in the same project root:

```yaml
- run: ohrisk ci --all --prod --fail-on high
```

Ohrisk merges the graphs by Package URL, removes duplicate package records, and
keeps each contributing lockfile in package provenance. Use `--lockfile` only
when CI intentionally scans one lockfile; `--all` and `--lockfile` cannot be
combined.

## Cache, offline mode, and private registries

Reuse the persistent artifact cache and control evidence collection explicitly:

```yaml
- run: >-
    ohrisk ci --all --prod
    --cache-dir .ohrisk-cache
    --jobs 8
    --timeout 30s
```

Run without network access after priming the cache:

```yaml
- run: ohrisk ci --all --offline --cache-dir .ohrisk-cache
```

For a private npm registry, keep the token in an environment variable and
allow only the registry hostname:

```yaml
- run: >-
    ohrisk ci
    --registry-url https://npm.example.com/
    --registry-token-env OHRISK_REGISTRY_TOKEN
    --allow-host npm.example.com
  env:
    OHRISK_REGISTRY_TOKEN: ${{ secrets.OHRISK_REGISTRY_TOKEN }}
```

Authentication is sent only to the configured registry host. See
[Cache and Registry Configuration](cache-and-registries.md).

## Markdown report as an artifact

```yaml
- run: ohrisk scan --markdown --prod --output reports/ohrisk.md
- uses: actions/upload-artifact@v7
  with:
    name: ohrisk-markdown
    path: reports/ohrisk.md
```

## SARIF output

```yaml
- run: ohrisk scan --sarif --output reports/ohrisk.sarif
- uses: actions/upload-artifact@v7
  with:
    name: ohrisk-sarif
    path: reports/ohrisk.sarif
```

Uploading SARIF to GitHub code scanning requires a separate
`github/codeql-action/upload-sarif` step and `security-events: write`.

## CycloneDX SBOM

```yaml
- run: ohrisk scan --cyclonedx --prod --output reports/ohrisk.cdx.json
- uses: actions/upload-artifact@v7
  with:
    name: ohrisk-sbom
    path: reports/ohrisk.cdx.json
```

## Waiver checks

Ignore local waiver files for a raw audit:

```yaml
- run: ohrisk ci --no-waivers --fail-on high
```

Fail on expired or unmatched waivers:

```yaml
- run: ohrisk ci --strict-waivers
```

`--no-waivers` and `--strict-waivers` cannot be combined.

## Profile selection

```yaml
- run: ohrisk ci --prod --profile saas --fail-on high
- run: ohrisk ci --prod --profile distributed-app --fail-on high
```

The default profile is `saas`. A policy file may override either profile
without changing the CLI command.

## Boundary

Ohrisk is a risk decision aid, not legal advice. It does not guarantee that all
risks are detected or provide a legal verdict. CI gates surface license
evidence early; they do not replace legal review.
