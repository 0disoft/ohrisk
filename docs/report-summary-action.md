# GitHub Step Summary Action

The nested `summary-action` renders an existing Ohrisk scan or diff JSON report into `GITHUB_STEP_SUMMARY`. It also exposes stable scalar outputs for later workflow conditions. It does not scan dependencies, call the GitHub API, post pull-request comments, or require write permissions.

## Generate and summarize one report

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v7

  - uses: 0disoft/ohrisk@v1.15.1
    id: ohrisk
    with:
      command: ci
      format: json
      output: reports/ohrisk.json
      prod: "true"
      fail-on: high

  - uses: 0disoft/ohrisk/summary-action@v1.15.1
    if: ${{ always() && hashFiles('reports/ohrisk.json') != '' }}
    id: ohrisk-summary
    with:
      report: reports/ohrisk.json
      max-findings: "20"
```

The report-producing step remains the risk gate. The summary action only renders the completed report, so it does not need `pull-requests: write` and does not duplicate evidence collection.

## Outputs

The action exposes `status`, `report-type`, `failed`, `completeness`, `finding-count`, `failing-finding-count`, `high-count`, `unknown-count`, `review-count`, `low-count`, `waived-count`, and `waiver-drift-failed`.

```yaml
  - name: Record the high-risk count
    if: ${{ always() && steps.ohrisk-summary.outcome == 'success' }}
    run: echo "high=${{ steps.ohrisk-summary.outputs.high-count }}"
```

Every output is a bounded scalar value. Finding details stay in the report artifact and the escaped Markdown step summary.

## Rendering limits and path boundary

`max-findings` accepts an integer from `0` to `100` and defaults to `20`. Findings are sorted by severity, then package and finding identifier. Additional findings are counted but omitted from the Markdown table.

The `report` input must be repository-relative. The action resolves the real report path and rejects traversal or a symbolic link that escapes `GITHUB_WORKSPACE`. Markdown table cells escape HTML delimiters, pipes, and newlines before writing to the step summary.

## Standalone command

The npm package also publishes the same renderer as `ohrisk-summary`:

```sh
ohrisk-summary --report reports/ohrisk.json --max-findings 20
```

Use `--json` for a machine-readable summary. Its closed Draft 2020-12 contract
is exported as `ohrisk/schemas/report-summary`, with the matching
`ReportSummary` TypeScript type available from `ohrisk/report-types`.
`--step-summary` appends Markdown to `GITHUB_STEP_SUMMARY`, while
`--github-output <path>` writes the scalar outputs using the GitHub Actions
environment-file format.
