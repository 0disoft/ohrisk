# Action Contract

- Status: Project-owned
- Repository Type: github-action

## Execution model

The composite action optionally runs a commit-SHA-pinned `actions/setup-node`
step, then invokes the CLI bundled in `action-dist/cli.js`. The default path
performs no npm package resolution. Persistent artifact caching is separately
opt-in and uses commit-SHA-pinned `actions/cache/restore` and
`actions/cache/save` steps.

Every Boolean input, including `setup-node` and `cache`, is validated as the
literal string `true` or `false`; other values fail before Ohrisk scans the
project.

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
`diff`: `high`, `unknown`, `review`, or `low`.

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

`ci` fails partial evidence or repository coverage independently of `fail-on`.
The Boolean `allow-partial-evidence` input is an explicit CI-only override and
is rejected for `scan` and `diff`.

## Persistent artifact cache

Persistent caching is disabled by default. `cache` is an Action-only
orchestration input; the CLI continues to own `--cache-dir`. `cache: "true"`
restores and saves the CLI's existing artifact cache without introducing a
second cache format. If
`cache-dir` is empty, the action uses `.ohrisk-cache`; an explicit
repository-relative `cache-dir` overrides that path. With persistence disabled,
a non-empty `cache-dir` is still passed to the CLI for job-local caching.

Because the cache directory lives inside the checked-out workspace, add the
chosen path to the consuming repository's ignore rules when later steps require
a clean `git status`.

The restore and save actions are pinned to exact commits. Cache keys include a
format prefix, runner OS, runner architecture, a digest of supported dependency
inputs, and the exact SHA-256 of an `archive` input when present. A
same-platform restore prefix permits a warm cache after dependency files
change. The prefix is versioned so a future incompatible layout can move to a
new namespace without reading old entries.

The effective cache path is validated before restoration and revalidated before
the CLI receives `--cache-dir`. Absolute, drive-qualified, parent-traversing,
dot-segment, control-character, and symbolic-link paths are rejected. A
pre-existing non-empty target must contain the exact regular-file Ohrisk
artifact-cache ownership marker, preventing restoration over arbitrary source
or repository-control data. Archive
paths are also validated before hashing, and archive bytes are streamed into
the digest rather than loaded into memory.

Restore and save failures use `continue-on-error`, so a GitHub cache-service
failure never replaces the Ohrisk result. The save step runs after a successful
scan or a failed risk gate, skips exact cache hits, and does not run after
cancellation or invalid cache settings. The `cache-hit` output exposes only the
restore action's exact-match result.

Private-registry package bytes can be part of the artifact cache. Enable
persistence only when the repository's GitHub cache visibility is acceptable;
credentials and authorization headers are still excluded.

Ohrisk cache metadata excludes raw URLs, authorization headers, credentials,
and token values. Content objects retain the CLI's size and SHA-256 validation,
ownership marker, and corruption cleanup. GitHub's own cache visibility and
branch scoping remain controlled by the calling repository and workflow.

## Version selection

The default `bundled` value uses the embedded CLI without an extra assertion.
Explicit values must be exact semantic versions such as `1.2.3`, `v1.2.3`, or
an exact prerelease. Mutable tags, ranges, Git references, and local package
paths are rejected.

## Path safety

The `lockfile`, `archive`, `policy`, `cache-dir`, and `output` inputs must be
repository-relative paths. The action rejects absolute paths, Windows drive
paths, UNC paths, empty segments, `.` segments, and `..` segments before the
CLI runs. Control characters are rejected. Existing path components for
`lockfile`, `policy`, and `cache-dir` must not be symbolic links. `archive`
must additionally name an existing regular file inside the checked-out
repository, and symbolic-link traversal is rejected. The action never creates
an output parent before invoking the CLI; the contained report writer performs
and revalidates that operation.

## Network boundary

`offline` prevents network access. `registry-url` must be HTTPS,
`registry-token-env` names the environment variable that holds a token, and
`allow-hosts` extends the artifact host allowlist. Authentication is forwarded
only to the configured registry host.

## Permissions

The action itself does not upload SARIF or artifacts and does not request
additional token permissions for persistent caching. Workflows that upload
SARIF must grant `security-events: write` to the upload step.

The nested `summary-action` is report-driven and permissionless. It reads one
workspace-contained Ohrisk 3.5 scan or diff JSON report, writes escaped bounded
Markdown only to the runner-provided step-summary file, and writes bounded
scalar values only to the runner-provided output file. It performs no scan,
network request, GitHub API call, or pull-request mutation.

## Validation

Any input, version, path, network, shell, or cache behavior change must update
`action.yml`, the action documentation, and the contract tests. The bundled
`action-dist/cli.js` must be rebuilt from the same source version before a tag
is published. The Linux release gate must match a fresh build to the checked-in
bundle byte for byte. Windows and macOS must pass the bounded platform and
installed-package smoke suite; platform markers and absolute build-machine
paths are forbidden.
