# Command Contract

- Status: Project-owned
- Repository Type: cli-tool

## Runtime

The published CLI runs on Node.js `>=24.0.0`. Bun is used for repository
development, tests, and packaging.

## Commands

| Command | Contract |
| --- | --- |
| `ohrisk scan` | Scan local dependency evidence and render a non-failing report unless an output/write error occurs. |
| `ohrisk ci` | Run a scan and exit non-zero when active findings meet `--fail-on` after waiver handling. |
| `ohrisk diff <ref>` | Compare findings against a git baseline and report new or meaningfully changed risk. |
| `ohrisk explain <expr>` | Classify one license expression for the selected profile without scanning a project. |

## Stable Options

- `--profile saas|distributed-app` selects the shipping model.
- `--prod` narrows scans to production-relevant dependencies when supported by the input ecosystem.
- `--fail-on unknown|review|high|low` controls CI failure threshold.
- `--json`, `--markdown`, `--html`, `--sarif`, and `--cyclonedx` select report formats.
- `--output <path>` writes a report artifact.
- `--language <locale>` localizes HTML report chrome and Ohrisk-generated review text.
- `--no-waivers` ignores local waiver files.
- `--strict-waivers` fails on expired or unmatched waivers.

## Output Requirements

- JSON, Markdown, HTML, SARIF, and CycloneDX behavior is owned by `docs/report-formats.md`.
- Shareable formats must not expose absolute local project roots.
- Machine-readable IDs, fingerprints, enum values, and paths must remain stable unless the change is documented and tested.

## Validation

- Run `bun run typecheck` and `bun test` for CLI behavior changes.
- Run `bun run verify:release` for package or published CLI surface changes.
