# Validation

- Status: Project-owned

## Validation Source of Truth

This document names stable validation expectations for Ohrisk changes.

## Standard Validation Names

- typecheck: `bun run typecheck`
- test: `bun test`
- release-check: `bun run verify:release`
- package-smoke: covered by `bun run verify:release`
- scaffold-doctor: `ssealed doctor --strict`

## Change-Specific Expectations

- CLI argument or command behavior: run `bun run typecheck` and `bun test`.
- Parser, evidence, policy, waiver, or report-renderer behavior: run `bun test`; prefer targeted tests first when debugging, then the full suite.
- README, docs, or examples: run relevant documentation contract tests when present, and include `bun test` before claiming full readiness.
- GitHub Action behavior: validate `action.yml` path/input changes against `docs/github-actions.md` and run the test suite.
- Release or package-surface behavior: run `bun run verify:release`.
- ssealed scaffold metadata or generated guidance: run `ssealed doctor --strict`.

## Required Final Report

Final responses must list executed validations, passed validations, skipped validations, skip reasons, and remaining risk.

## Runner Policy

Ohrisk owns its `package.json` scripts. The ssealed scaffold was adopted with `runner: none`, so package runner blocks are project-owned and must not be rewritten by scaffold updates.

## Hygiene Validation

Repository hygiene changes must check line-ending churn, tracked secret files, ignored build/cache artifacts, and generated-output drift.
