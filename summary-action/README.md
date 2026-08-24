# Ohrisk report summary action

This nested action renders an existing Ohrisk scan or diff JSON report in the GitHub Actions step summary and exposes scalar count outputs. It performs no scan and requires no GitHub write permission.

```yaml
- uses: 0disoft/ohrisk/summary-action@v1.15.1
  if: ${{ always() && hashFiles('reports/ohrisk.json') != '' }}
  id: ohrisk-summary
  with:
    report: reports/ohrisk.json
    max-findings: "20"
```

See [`docs/report-summary-action.md`](../docs/report-summary-action.md) for the full workflow and output contract.
