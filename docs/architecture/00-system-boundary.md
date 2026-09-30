# System Boundary

- Status: Project-owned

## Boundary

Ohrisk is a local scanner and report generator. It reads local dependency
metadata, lockfiles, waiver files, and selected license evidence. It writes
reports only when the user provides an output path.

For `scan` and `ci`, a supported archive may replace the filesystem project
input. Ohrisk indexes and materializes bounded regular-file entries in memory;
it does not extract them to disk, recurse into nested archives, or trust policy
and waiver files stored inside the archive. Host policy and waivers remain
outside the archive trust boundary.

## Owned Components

Inspection responsibilities are separated at these internal boundaries:

- `src/cli/main.ts`: command dispatch, report emission and command exit results.
- `src/cli/scan-engine.ts`: project discovery, evidence runtime, collection and snapshot replay.
- `src/cli/scan-policy.ts` and `src/policy/`: graph selection, evaluation, waivers and independent gates.
- `src/report/scan-model.ts`: shared provenance, evidence counts and decision summaries.
- `src/report/scan-report.ts`, `html-scan-report.ts` and `html-scan-filter.ts`: text/JSON/Markdown, HTML markup and browser filtering respectively.

Renderers share a result model; model helpers do not import renderer code at
runtime. CLI and diff use the same collection entry points. Extraction preserves
the existing report schemas and output behavior.

- CLI argument parsing and command dispatch under `src/cli/`.
- Dependency graph parsers under `src/graph/`.
- License evidence collectors under `src/evidence/`.
- Risk policy, waiver matching, findings, and renderers under `src/`.
- Composite GitHub Action behavior in `action.yml`.
- Documentation and examples in `README.md` and `docs/`.

## External Boundaries

- npm package installation is used by published CLI users and the GitHub Action.
- GitHub Actions hosts execute `action.yml` as a composite action.
- Remote fetching is constrained by `docs/remote-fetching.md`.
- Untrusted archive parsing accepts only the documented ZIP/TAR subset and fails
  closed on path, type, size, compression, deadline, and integrity violations.
- Legal interpretation remains outside the product boundary.

## Quality Attributes

- Deterministic local scans where input files are unchanged.
- Stable machine-readable output for CI consumers.
- No absolute path leakage in shareable report artifacts.
- Clear failure modes for invalid CLI or GitHub Action inputs.
