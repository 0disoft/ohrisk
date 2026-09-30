# Validation

- Status: Project-owned

## Validation Source of Truth

This document names stable validation expectations for Ohrisk changes.

## Standard Validation Names

- typecheck: `bun run typecheck`
- test: `bun test`
- coverage: `bun run test:coverage` enforces global LCOV totals of at least 82%
  lines and 90% functions. Bun's per-file threshold is intentionally unset so
  supported Bun versions use the same repository-owned gate.
- release-check: `bun run verify:release`
- package-smoke: covered by `bun run verify:release`
- scaffold-doctor: `ssealed doctor --strict`

## Change-Specific Expectations

`test/parser-fuzz.test.ts` exercises every registered lockfile kind using a
fixed malformed corpus plus three deterministic mutation seeds. Successful
parses must have unique package IDs and references to existing nodes. Failed
generated cases retain the exact synthetic text or archive bytes, seed and
case index under ignored `.tmp/parser-fuzz-repro/`; review a retained case
before promoting it into a permanent regression fixture. Each synchronous parse
is checkpointed so that a timeout also retains its
last attempted input. Successful probes replace their checkpoint with a small
passed marker; the three fixed seeds bound retained probe-file count.
Input generation is bounded to 32 cases per seed and 8192 UTF-16 code units per text. This checks
boundary safety and structural invariants, not license-classification accuracy.

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
