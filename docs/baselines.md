# Checked-in Risk Baselines

A checked-in Ohrisk baseline lets CI reject newly introduced license risk without fetching a Git baseline ref. It is intended for shallow clones, source archives, generated build workspaces, and CI systems that do not expose repository history.

The baseline is a reviewed decision record, not an approval of every dependency it contains. Regenerate it only after reviewing the current findings.

## Create the first baseline

Generate a normal Ohrisk scan report, then reduce it to stable semantic fingerprints:

```sh
ohrisk scan --prod --profile saas --json --output .ohrisk-current.json
ohrisk-baseline create \
  --report .ohrisk-current.json \
  --output .ohrisk-baseline.json
```

Review and commit `.ohrisk-baseline.json`. The file is deterministic and omits timestamps, so repeating the command with an unchanged report does not create churn.

The baseline records the scan-report schema, profile, production scope, effective policy-content digest, and each finding's stable identity, semantic fingerprint, and severity. It does not copy explanatory prose, evidence paths, policy contents, or absolute local paths.

## Gate a build without Git history

```sh
ohrisk scan --prod --profile saas --json --output .ohrisk-current.json
ohrisk-baseline check \
  --report .ohrisk-current.json \
  --baseline .ohrisk-baseline.json \
  --fail-on high
```

The check exits with status `1` when a new finding, changed semantic fingerprint, or severity escalation meets the selected threshold. Findings are correlated by stable finding ID, so an escalation remains detectable even though severity is part of the semantic fingerprint. It exits with status `2` for malformed input or configuration drift. Configuration drift is rejected because comparing findings created under different profiles, production scopes, report schemas, or effective policy contents would hide a change in the decision boundary.

Use `--json` to obtain a machine-readable result containing counts plus the introduced and failing findings:

```sh
ohrisk-baseline check \
  --report .ohrisk-current.json \
  --baseline .ohrisk-baseline.json \
  --fail-on review \
  --json
```

The npm package publishes Draft 2020-12 contracts for both durable baseline
files and machine-readable check results as `ohrisk/schemas/baseline` and
`ohrisk/schemas/baseline-check`. Matching TypeScript types are available from
`ohrisk/report-types` as `OhriskBaseline` and `BaselineCheckReport`.

## Review an intentional change

When a dependency change is accepted, review the full current Ohrisk report first. Then regenerate the baseline from that exact report and commit both the dependency change and baseline update in the same pull request:

```sh
ohrisk-baseline create \
  --report .ohrisk-current.json \
  --output .ohrisk-baseline.json
```

Do not use baseline regeneration as an automatic post-failure step. Automatic regeneration turns the gate into a no-op and removes the human decision record.

## Baselines and waivers

Use a baseline to distinguish existing findings from newly introduced risk. Use a waiver to document a deliberate exception for one active finding, including its reason and expiry. A baseline should not replace waiver expiry or strict waiver-drift checks.
