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

`scan` may also accept one public GitHub HTTPS repository URL, materialize a
bounded depth-one temporary checkout, scan it without trusting checkout-local
policy, waivers, symlinks, submodule contents, or local package evidence, and remove the
checkout afterward. Remote HTML scans default their report file to the host
invocation directory. This input is CLI-only and is not part of `ci`, `diff`, or
the composite GitHub Action contract. Submodule gitlinks are skipped by default
with incomplete-coverage metadata in every report; strict rejection is available
through `--submodules reject`. Symbolic links are always skipped without
following targets, reported separately as incomplete coverage, and cannot
supply dependency inputs. Structurally safe regular files with non-portable
names are excluded before checkout and reported separately; traversal and
repository-control paths still fail. When the repository root has no supported input,
Ohrisk automatically selects one nested dependency project or merges multiple
nested projects into a repository-wide graph with lockfile provenance. Automatic
fan-out is capped at 64 project roots and 128 inputs; `--lockfile` remains the
explicit narrowing control.

Maven license evidence uses local POMs, then Maven Central, then only those
project-declared HTTPS repositories whose exact host is explicitly allowed by
the caller or host-owned policy. If a verified POM chain has no license name,
Ohrisk may inspect a bounded JAR only after a same-repository SHA-256 checksum
and exact embedded Maven identity are verified. Missing or unusable optional JAR
evidence remains `unknown`; checksum or identity disagreement fails closed.

## Commands

- `ohrisk scan`: non-failing local scan and report generation.
- `ohrisk ci`: CI gate that exits non-zero when active findings meet `--fail-on`.
- `ohrisk diff <ref>`: compares current findings against a git baseline, separates new, changed, and resolved findings, and independently discovers and merges current/baseline input sets with `--all`.
- `ohrisk explain <expr>`: classifies one license expression without scanning a project.
- `ohrisk cache status|prune|clear`: inspects or cleans the shared persistent artifact cache without scanning.

## Risk Model

- Severities are `low`, `review`, `high`, and `unknown`.
- Usage profiles are `saas` and `distributed-app`.
- Commercial restrictions explicitly scoped to documentation or data remain
  evidence for those assets and do not override a separate package-code license.
- Waivers may suppress matching findings, but strict waiver drift can fail CI.
- Shareable formats must avoid leaking absolute local paths.

## Output Contract

Supported formats are terminal text, JSON, Markdown, HTML, SARIF, and CycloneDX.
Scan, diff, and explain JSON use strict packaged Draft 2020-12 schema 3.4.0
contracts. Scan JSON includes typed evidence source and graph diagnostics plus
optional remote repository, skipped-submodule, skipped-symbolic-link, and
skipped-non-portable-path
coverage metadata; diff
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
