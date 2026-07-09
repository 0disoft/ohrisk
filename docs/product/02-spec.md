# Product Specification

- Status: Project-owned
- Owner: UNASSIGNED

## Product Contract

Ohrisk scans a project dependency graph, derives license evidence, applies a
shipping-profile-aware risk policy, applies local waivers unless disabled, and
renders the result for local review or CI gates.

## Commands

- `ohrisk scan`: non-failing local scan and report generation.
- `ohrisk ci`: CI gate that exits non-zero when active findings meet `--fail-on`.
- `ohrisk diff <ref>`: compares current findings against a git baseline.
- `ohrisk explain <expr>`: classifies one license expression without scanning a project.

## Risk Model

- Severities are `low`, `review`, `high`, and `unknown`.
- Usage profiles are `saas` and `distributed-app`.
- Waivers may suppress matching findings, but strict waiver drift can fail CI.
- Shareable formats must avoid leaking absolute local paths.

## Output Contract

Supported formats are terminal text, JSON, Markdown, HTML, SARIF, and CycloneDX.
Format-specific behavior is owned by `docs/report-formats.md` and matching tests.

## GitHub Action Contract

The composite action in `action.yml` installs the published npm package and runs
Ohrisk with validated inputs. Repository-relative path validation for `lockfile`
and `output` is part of the public action contract.
