# Product Brief

- Status: Project-owned
- Owner: UNASSIGNED

## Purpose

Ohrisk helps developers catch open-source license risk before a PR or release ships.
It scans local dependency manifests and lockfiles, classifies license evidence by
shipping profile, and emits human-readable or machine-readable reports.

## Primary Users

- Developers adding or upgrading dependencies.
- Maintainers gating pull requests.
- Release owners producing SARIF, Markdown, HTML, JSON, or CycloneDX artifacts.
- Reviewers checking waiver drift before accepting known risk.

## Non-Goals

- Ohrisk is not legal advice.
- Ohrisk does not approve dependencies on behalf of a project.
- Ohrisk does not silently fetch unbounded remote evidence.
- Ohrisk does not require Bun for published CLI users.

## Source of Truth

- Public overview: `README.md`
- Detailed docs: `docs/README.md`
- CLI contract: `docs/cli/command-contract.md`
- GitHub Action contract: `docs/github-action/action-contract.md`
