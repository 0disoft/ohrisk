# Inputs and Outputs

- Status: Project-owned
- Repository Type: github-action

## Inputs

| Input | Contract |
| --- | --- |
| `version` | `bundled` or an exact semantic version assertion that must match the CLI embedded in the action release. |
| `node-version` | Node.js version passed to `actions/setup-node` when setup is enabled. |
| `setup-node` | Boolean string controlling whether `actions/setup-node` runs. |
| `command` | `scan` or `ci`; defaults to `ci`. |
| `profile` | `saas` or `distributed-app`; defaults to `saas`. |
| `prod` | Boolean string controlling production dependency filtering. |
| `fail-on` | CI severity threshold. Empty disables threshold forwarding. |
| `lockfile` | Optional repository-relative lockfile path. Cannot be combined with `all`. |
| `all` | Boolean string that scans every supported lockfile in the detected project root. |
| `policy` | Optional repository-relative `.ohrisk.yml`-compatible policy path. |
| `offline` | Boolean string that disables network access. |
| `cache-dir` | Optional repository-relative persistent artifact cache directory. |
| `jobs` | Evidence collection concurrency from 1 through 64. |
| `timeout` | Remote evidence timeout from 100 ms through 10 minutes, such as `30s`. |
| `registry-url` | HTTPS npm registry base URL. |
| `registry-token-env` | Name of the environment variable containing the registry token. |
| `allow-hosts` | Newline- or comma-separated additional artifact hostnames. |
| `format` | `text`, `json`, `sarif`, `markdown`, `html`, or `cyclonedx`. |
| `output` | Optional repository-relative report output path. |
| `no-waivers` | Boolean string controlling waiver loading. |
| `strict-waivers` | Boolean string controlling waiver drift failure. |

## Outputs

| Output | Contract |
| --- | --- |
| `report-path` | Set when `output` is provided and the CLI writes a report. |

## Validation

Boolean inputs accept only `true` or `false`. Paths are validated before any
directory is created, exact version syntax and bundle equality are checked before the scan runs, and the
action rejects incompatible `lockfile` plus `all` inputs.
