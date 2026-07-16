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

## Command selection

The action accepts `scan`, `ci`, and `diff`. `diff` requires `baseline-ref`,
which is forwarded as one argument without shell re-parsing; option-shaped
values are rejected before the CLI runs, and `scan` and `ci` reject that input.
The `fail-on` input defaults to empty. That makes `scan`
usable without an incompatible threshold while leaving `ci` at the CLI-owned
default threshold of `high`; explicit thresholds are supported for `ci` and
`diff`.

The action does not fetch Git history. The calling workflow owns checkout depth
and baseline availability, so `diff` callers must configure `actions/checkout`
with suitable history (commonly `fetch-depth: 0`) or fetch the baseline ref
before invoking Ohrisk.

`diff` accepts only `text`, `json`, or `markdown` output. The action rejects
SARIF, HTML, and CycloneDX for `diff` before invoking the CLI; those formats are
available for `scan` and `ci`.

`diff` compares unwaived findings, so the action rejects `no-waivers` for that
command. `strict-waivers` is a CI-only drift gate and is rejected for both
`scan` and `diff`.

The optional `archive` input is supported only by `scan` and `ci`. It is
forwarded as `--archive` after path validation, cannot be combined with
`lockfile`, and is rejected for `diff`. `all: "true"` remains valid and asks the
CLI to scan every supported lockfile found at the single archive project root.

## Version selection

The default `bundled` value uses the embedded CLI without an extra
assertion. Explicit values must be exact semantic versions such as `1.2.3`, `v1.2.3`, or an exact prerelease. Mutable tags,
ranges, Git references, and local package paths are rejected.

## Path safety

The `lockfile`, `archive`, `policy`, `cache-dir`, and `output` inputs must be
repository-relative paths. The action rejects absolute paths, Windows drive
paths, UNC paths, empty segments, `.` segments, and `..` segments before the
CLI runs. `archive` must additionally name an existing regular file inside the
checked-out repository; symbolic-link traversal is rejected.

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
