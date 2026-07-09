# System Boundary

- Status: Project-owned

## Boundary

Ohrisk is a local scanner and report generator. It reads local dependency
metadata, lockfiles, waiver files, and selected license evidence. It writes
reports only when the user provides an output path.

## Owned Components

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
- Legal interpretation remains outside the product boundary.

## Quality Attributes

- Deterministic local scans where input files are unchanged.
- Stable machine-readable output for CI consumers.
- No absolute path leakage in shareable report artifacts.
- Clear failure modes for invalid CLI or GitHub Action inputs.
