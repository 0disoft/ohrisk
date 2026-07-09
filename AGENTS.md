# AGENTS.md

## Repository Scope

Ohrisk is a TypeScript CLI and composite GitHub Action that scans dependency
manifests and lockfiles for open-source license risk.

This repository owns:

- CLI behavior for `ohrisk scan`, `ohrisk ci`, `ohrisk diff`, and `ohrisk explain`.
- Dependency graph parsers under `src/graph/`.
- License evidence collectors under `src/evidence/`.
- Risk policy, waiver handling, report rendering, and output contracts.
- The composite GitHub Action in `action.yml`.
- User documentation under `README.md` and `docs/`.

This repository does not provide legal advice. Findings are decision-support
evidence and must not be described as legal approval.

## Source of Truth

- Product behavior: `README.md`, `docs/README.md`, and `docs/product/02-spec.md`
- CLI command contract: `docs/cli/command-contract.md`
- GitHub Action contract: `action.yml`, `docs/github-actions.md`, and `docs/github-action/action-contract.md`
- Report formats: `docs/report-formats.md`
- CI usage: `docs/ci.md`
- Risk profiles: `docs/profiles.md`
- Waivers: `docs/waivers.md`
- Remote evidence boundary: `docs/remote-fetching.md`
- Validation routing: `VALIDATION.md`
- Agent routing: `.agents/context-map.md`

## Hard Rules

- Do not change severity semantics without updating tests and user-facing docs.
- Do not expose absolute local paths in shareable report formats.
- Do not add remote registry fetching without preserving the documented remote-fetching boundary.
- Do not weaken action input path validation for `lockfile` or `output`.
- Do not treat generated output, `dist/`, caches, or local reports as source truth.
- Do not alter package runner scripts unless the change is explicitly about project-owned build or release behavior.

## Before Editing

- Read this file, `VALIDATION.md`, `CHECKLIST.md`, and `.agents/context-map.md`.
- For CLI behavior, read `docs/cli/command-contract.md` and the relevant parser, policy, or renderer tests.
- For GitHub Action behavior, read `action.yml`, `docs/github-actions.md`, and `docs/github-action/action-contract.md`.
- For documentation changes, keep README, docs guides, and tests such as `test/readme-contract.test.ts` aligned.

## Validation Expectations

- Use `bun run typecheck` for TypeScript type validation.
- Use `bun test` for the test suite.
- Use `bun run verify:release` before release or package-surface claims.
- Use `ssealed doctor --strict` after scaffold metadata changes.

## Final Response Requirements

- List validations run, validations skipped, skip reasons, and remaining risk.
- Call out CLI, report-format, GitHub Action, dependency-parser, waiver, and release-surface changes explicitly.
- Mention any source-of-truth docs changed.
