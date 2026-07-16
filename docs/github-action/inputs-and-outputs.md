# Inputs and Outputs

- Status: Project-owned
- Repository Type: github-action

## Inputs

| Input | Contract |
| --- | --- |
| `version` | `bundled` or an exact semantic version assertion that must match the CLI embedded in the action release. |
| `node-version` | Node.js version passed to `actions/setup-node` when setup is enabled. |
| `setup-node` | Boolean string controlling whether `actions/setup-node` runs. |
| `command` | `scan`, `ci`, or `diff`; defaults to `ci`. |
| `baseline-ref` | Git baseline ref required by `command: diff`; rejected for `scan` and `ci`, and rejected when it starts like a CLI option. |
| `profile` | `saas` or `distributed-app`; defaults to `saas`. |
| `prod` | Boolean string controlling production dependency filtering. |
| `fail-on` | Optional `ci` or `diff` severity threshold. Empty forwards no flag, so `ci` keeps the CLI default of `high`; `scan` rejects a non-empty value. |
| `lockfile` | Optional repository-relative lockfile path. Cannot be combined with `all`. |
| `archive` | Optional repository-relative regular file containing a ZIP, TAR, TAR.GZ, or TGZ project. Supported by `scan` and `ci`, forwarded as `--archive`, rejected for `diff`, and mutually exclusive with `lockfile`. Symbolic-link traversal is rejected. |
| `all` | Boolean string that scans every supported lockfile in the detected project root. |
| `policy` | Optional repository-relative `.ohrisk.yml`-compatible policy path. |
| `offline` | Boolean string that disables network access. |
| `cache-dir` | Optional repository-relative persistent artifact cache directory. |
| `jobs` | Evidence collection concurrency from 1 through 64. |
| `timeout` | Remote evidence timeout from 100 ms through 10 minutes, such as `30s`. |
| `registry-url` | HTTPS npm registry base URL. |
| `registry-token-env` | Name of the environment variable containing the registry token. |
| `allow-hosts` | Newline- or comma-separated additional artifact hostnames. |
| `format` | `text`, `json`, `sarif`, `markdown`, `html`, or `cyclonedx`. `diff` accepts only `text`, `json`, or `markdown`, matching the CLI contract. |
| `output` | Optional repository-relative report output path. |
| `no-waivers` | Boolean string controlling waiver loading for `scan` and `ci`; rejected for `diff`, which compares unwaived findings. |
| `strict-waivers` | Boolean string controlling waiver drift failure for `ci`; rejected for `scan` and `diff`. |

## Outputs

| Output | Contract |
| --- | --- |
| `report-path` | Set when `output` is provided and the CLI writes a report. |

## Validation

Boolean inputs accept only `true` or `false`. Paths are validated before any
directory is created, exact version syntax and bundle equality are checked before the scan runs, and the
action rejects incompatible `lockfile` plus `all` and `archive` plus `lockfile`
inputs. `archive` may be combined with `all`.

`diff` passes the baseline ref as one argument without shell re-parsing. The
calling workflow owns checkout history and ref availability; use an appropriate
`actions/checkout` `fetch-depth` (commonly `0`) or fetch the baseline before the
action runs.
