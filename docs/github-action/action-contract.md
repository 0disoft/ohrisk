# Action Contract

- Status: Project-owned
- Repository Type: github-action

## Execution model

The composite action optionally runs a commit-SHA-pinned `actions/setup-node`
step, then invokes the CLI bundled in `action-dist/cli.js`. The default path
performs no npm package resolution.

The action never resolves or installs an npm package at workflow runtime. The
optional `version` input is an assertion against the version embedded in the
bundle, so a workflow fails before scanning when its expected CLI version does
not match the action release.

## Version selection

The default `bundled` value uses the embedded CLI without an extra
assertion. Explicit values must be exact semantic versions such as `1.2.3`, `v1.2.3`, or an exact prerelease. Mutable tags,
ranges, Git references, and local package paths are rejected.

## Path safety

The `lockfile`, `policy`, `cache-dir`, and `output` inputs must be
repository-relative paths. The action rejects absolute paths, Windows drive
paths, UNC paths, empty segments, `.` segments, and `..` segments before the
CLI runs.

## Network boundary

`offline` prevents network access. `registry-url` must be HTTPS,
`registry-token-env` names the environment variable that holds a token, and
`allow-hosts` extends the artifact host allowlist. Authentication is forwarded
only to the configured registry host.

## Permissions

The action itself does not upload SARIF or artifacts. Workflows that upload
SARIF must grant `security-events: write` to the upload step.

## Validation

Any input, version, path, network, or shell behavior change must update
`action.yml`, the action documentation, and the contract tests. The bundled
`action-dist/cli.js` must be rebuilt from the same source version before a tag
is published.
