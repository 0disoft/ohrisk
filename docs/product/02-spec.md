# Product Specification

- Status: Project-owned
- Owner: UNASSIGNED

## Product Contract

Ohrisk scans a project dependency graph, derives license evidence, applies a
shipping-profile-aware risk policy, applies local waivers unless disabled, and
renders the result for local review or CI gates.

`scan` and `ci` may treat a supported ZIP, TAR, TAR.GZ, or TGZ as a bounded,
read-only virtual project without disk extraction. Nested archives stay opaque,
and policy or waiver files inside the untrusted archive are never auto-loaded;
the host invocation directory remains the authority for both.

## Commands

- `ohrisk scan`: non-failing local scan and report generation.
- `ohrisk ci`: CI gate that exits non-zero when active findings meet `--fail-on`.
- `ohrisk diff <ref>`: compares current findings against a git baseline, separates new, changed, and resolved findings, and independently discovers and merges current/baseline input sets with `--all`.
- `ohrisk explain <expr>`: classifies one license expression without scanning a project.
- `ohrisk cache status|prune|clear`: inspects or cleans the shared persistent artifact cache without scanning.

## Risk Model

- Severities are `low`, `review`, `high`, and `unknown`.
- Usage profiles are `saas` and `distributed-app`.
- Waivers may suppress matching findings, but strict waiver drift can fail CI.
- Shareable formats must avoid leaking absolute local paths.

## Output Contract

Supported formats are terminal text, JSON, Markdown, HTML, SARIF, and CycloneDX.
Scan, diff, and explain JSON use strict packaged Draft 2020-12 schema 3.1.0
contracts. Scan JSON includes typed evidence source and graph diagnostics; diff
JSON records new, changed, and resolved findings plus current, baseline, added,
and removed lockfile sets.
Format-specific behavior is owned by `docs/report-formats.md` and matching tests.

## Cache Contract

Remote npm evidence uses a shared content-addressed cache with bounded freshness,
conditional HTTP revalidation, offline stale reads, and automatic LRU size
control. Cache location, cleanup commands, and credential boundaries are owned by
`docs/cache-and-registries.md` and `docs/remote-fetching.md`.

## GitHub Action Contract

The composite action in `action.yml` runs the checked-in CLI bundle without npm
resolution at workflow runtime. It supports `scan`, `ci`, and `diff`; diff
requires a caller-provided baseline ref and caller-managed Git history.
Repository-relative path validation for `lockfile`, `policy`, `cache-dir`, and
`output` is part of the public action contract. The optional `archive` input is
a contained repository-relative regular file, is forwarded only for `scan` and
`ci`, conflicts with `lockfile`, and remains compatible with `all`.
