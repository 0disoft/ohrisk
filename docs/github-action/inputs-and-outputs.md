# Inputs and Outputs

- Status: Project-owned
- Repository Type: github-action

## Inputs

| Input | Contract |
| --- | --- |
| `version` | npm package version to install; empty means tag-derived version for `v*` refs or `latest` otherwise. |
| `node-version` | Node.js version passed to `actions/setup-node` when setup is enabled. |
| `setup-node` | Boolean string controlling whether `actions/setup-node` runs. |
| `command` | Ohrisk command to run; defaults to `ci`. |
| `profile` | Risk profile passed to the CLI; defaults to `saas`. |
| `prod` | Boolean string controlling production dependency filtering. |
| `fail-on` | CI severity threshold. |
| `lockfile` | Optional repository-relative lockfile path. |
| `format` | Report format passed to the CLI. |
| `output` | Optional repository-relative report output path. |
| `no-waivers` | Boolean string controlling waiver loading. |
| `strict-waivers` | Boolean string controlling waiver drift failure. |

## Outputs

| Output | Contract |
| --- | --- |
| `report-path` | Set when the `output` input is provided and the CLI writes a report. |

## Boolean Inputs

Boolean inputs accept only `true` or `false`.
