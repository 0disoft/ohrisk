# GitHub Actions Guide

Use these workflows when you want Ohrisk to review dependency license risk in
pull requests. The examples install the published CLI from npm and do not need
project secrets.

Ohrisk is a risk decision aid, not legal advice. These workflows surface new
license evidence early; they do not replace legal review.

## Bundled action

The repository's composite action runs its checked-in CLI bundle and supports
`scan`, `ci`, and `diff`. A diff invocation requires a baseline ref:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0

- uses: 0disoft/ohrisk@v1.6.0
  with:
    command: diff
    baseline-ref: origin/main
    prod: "true"
    fail-on: high
```

The action passes `baseline-ref` as one argument, but it does not fetch Git
history. Checkout depth and baseline availability are the caller's
responsibility. For `scan`, leave `fail-on` empty (the default). For `ci`, an
empty action input preserves the CLI's `high` default.

To scan a source archive directly, pass a checked-in or downloaded
repository-relative regular file to `archive`:

```yaml
- uses: 0disoft/ohrisk@v1.6.0
  with:
    command: ci
    archive: artifacts/source.tar.gz
    all: "true"
```

The archive path must stay inside the checked-out repository and cannot use
symbolic links or be combined with `lockfile`. Archive input is supported only
for `scan` and `ci`; `diff` rejects it. The CLI reads supported entries in
memory without extracting files to disk, and it never auto-loads policy or
waiver files from the untrusted archive. Policy and waivers from the Action's
host working directory remain authoritative.

## PR Gate

Fail a pull request when production dependency changes introduce findings at or
above the selected threshold:

```yaml
name: License risk

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  ohrisk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - run: npm install -g ohrisk@1.6.0

      - run: ohrisk diff origin/main --prod --fail-on high
```

Pin `ohrisk@<version>` for stable CI. Use `--profile distributed-app` when the
dependency reaches users in a shipped app or binary.

## PR Comment

Generate a Markdown diff report and post it as a pull request comment. The
comment step uses a stable marker so repeated workflow runs update the previous
Ohrisk comment instead of creating a new one.

```yaml
name: License risk comment

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read
  pull-requests: write

jobs:
  ohrisk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - run: npm install -g ohrisk@1.6.0

      - name: Generate Ohrisk report
        run: |
          mkdir -p reports
          ohrisk diff origin/main --prod --markdown --output reports/ohrisk-pr.md

      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require("node:fs");
            const marker = "<!-- ohrisk-pr-comment -->";
            const report = fs.readFileSync("reports/ohrisk-pr.md", "utf8");
            const body = `${marker}\n${report}`;
            const { owner, repo } = context.repo;
            const issue_number = context.issue.number;
            const comments = await github.rest.issues.listComments({
              owner,
              repo,
              issue_number,
              per_page: 100,
            });
            const previous = comments.data.find((comment) =>
              comment.body?.startsWith(marker)
            );
            if (previous) {
              await github.rest.issues.updateComment({
                owner,
                repo,
                comment_id: previous.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner,
                repo,
                issue_number,
                body,
              });
            }
```

For pull requests from forks, GitHub may restrict `pull-requests: write` on the
default `GITHUB_TOKEN`. Keep the report artifact step even when comments are not
available.

## SARIF Upload

Upload Ohrisk SARIF to GitHub code scanning:

```yaml
name: License risk SARIF

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read
  security-events: write

jobs:
  ohrisk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - run: npm install -g ohrisk@1.6.0

      - run: |
          mkdir -p reports
          ohrisk scan --prod --sarif --output reports/ohrisk.sarif

      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: reports/ohrisk.sarif
```

## Waiver Drift

Fail CI when `.ohrisk-waivers.json` contains expired or unmatched waivers:

```yaml
- run: ohrisk ci --prod --strict-waivers
```

Use this with a separate risk threshold when you want both active findings and
stale exceptions to block the pull request:

```yaml
- run: ohrisk ci --prod --fail-on high --strict-waivers
```
