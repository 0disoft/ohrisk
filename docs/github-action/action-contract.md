# Action Contract

- Status: Project-owned
- Repository Type: github-action

## Execution Model

The action is a composite action. It optionally runs `actions/setup-node`,
installs `ohrisk@<version>` globally through npm, and invokes the selected
Ohrisk command.

## Version Selection

- Empty `version` uses the action tag version for `v*` refs.
- Empty `version` uses `latest` for non-version refs such as `main`.
- Explicit `version` accepts `latest`, `1.2.3`, `v1.2.3`, and semver prerelease forms.
- Other npm package specs are rejected before installation.

## Path Safety

The `lockfile` and `output` inputs must be repository-relative paths. The action
rejects absolute paths, Windows drive paths, UNC paths, empty segments, `.`
segments, and `..` segments before the CLI runs.

## Permissions

The action itself does not upload SARIF or artifacts. Workflows that upload
SARIF must grant `security-events: write` to the upload step.

## Validation

Any action input, version, path, or shell behavior change must update
`action.yml`, `docs/github-actions.md`, `docs/ci.md`, and relevant tests or
manual validation evidence.
