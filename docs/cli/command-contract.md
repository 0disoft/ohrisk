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
| `ohrisk diff <ref>` | Compare findings against a git baseline and classify new, meaningfully changed, and resolved risk. |
| `ohrisk explain <expr>` | Classify one license expression for the selected profile without scanning a project; `--policy` applies license-level organization rules only. |
| `ohrisk cache status|prune|clear` | Inspect or clean the persistent artifact cache without scanning a project. |

## Stable Options

- `--lockfile <path>` selects one supported input; `--all` discovers and merges all supported lockfiles at the selected project root. They are mutually exclusive for scan, CI, and diff.
- `scan|ci --archive <path>` scans a ZIP, TAR, TAR.GZ, or TGZ as a read-only in-memory virtual project. It is mutually exclusive with `--lockfile` and `--workspace-root`, may be combined with `--all`, and is not supported by `diff`.
- `--policy <path>` selects a workspace-contained policy file; otherwise `.ohrisk.yml` is loaded when present.
- `explain --policy <path>` accepts `--workspace-root <path>` for the inheritance boundary. It reports policy sources as relative paths and never applies package rules because explain has no package identity.
- `--profile saas|distributed-app` selects the shipping model, with organization policy overrides applied afterward.
- `--prod` narrows scans to production-relevant dependencies when supported by the input ecosystem.
- `--fail-on unknown|review|high|low` controls CI failure threshold.
- `--json`, `--markdown`, `--html`, `--sarif`, and `--cyclonedx` select report formats.
- `--output <path>` writes a report artifact.
- `--language <locale>` localizes HTML report chrome and Ohrisk-generated review text.
- `--no-waivers` ignores local waiver files; `--strict-waivers` fails on expired or unmatched waivers.
- `--offline` forbids network requests and permits only local or verified cached evidence.
- `--cache-dir <path>`, `--jobs <1..64>`, and `--timeout <duration>` configure persistent cache location and bounded evidence collection.
- `cache status|prune|clear` accepts `--cache-dir` and `--json`; `cache prune` also accepts `--max-size <bytes>` and `--max-age <duration>`.
- `--registry-url <https-url>`, `--registry-token-env <name>`, and repeatable `--allow-host <hostname>` configure a private npm-compatible registry without accepting raw token arguments.

## Archive Input

Archive scanning never extracts files to disk. ZIP support is limited to
stored or deflated entries; TAR and compressed TAR support accepts regular
files and directories, including bounded PAX/GNU long-name metadata. Nested
archives are opaque files. Encrypted, ZIP64, multi-disk, unsupported-compression,
special-file, malformed, type-conflicting, path-traversing, and integrity-failing
archives are rejected.

The default reader limits are 256 MiB input, 50,000 entries, 4,096 UTF-8 bytes
and 64 segments per path, 255 UTF-8 bytes per segment, 50 MiB per entry, 512 MiB
total expansion, 128 MiB materialized data, a 200:1 compression ratio for data
of at least 1 MiB, and a 30-second work budget. Crossing a limit fails the scan;
limits do not silently truncate the project.

Because compressed TAR must be indexed as one bounded stream, TAR.GZ and TGZ
also use the 128 MiB materialized-data ceiling for the expanded TAR container.

`.ohrisk.yml` and `.ohrisk-waivers.json` inside an archive are untrusted data and
are never auto-loaded. Policy inheritance and waiver loading continue from the
host invocation directory, so host policy and waivers remain authoritative.

## Multiple Lockfiles

`--all` only merges inputs discovered at the same project root. Package records
are deduplicated by Package URL while the original package identifier and every
contributing lockfile remain available as provenance. Conflicting package
metadata is reported instead of silently replacing the first deterministic
record.

`diff <ref> --all` independently discovers the supported input set in the
current worktree and the baseline git tree, parses each set with the same
ecosystem adapters, and then compares their merged findings. JSON diff output
includes `lockfileChanges.current`, `baseline`, `added`, and `removed`; terminal
and Markdown output summarize added and removed inputs. JSON also separates
`newFindings`, `changedFindings`, and `resolvedFindings`, while `findings`
remains the combined new-and-changed threshold set. A baseline with no
supported input is represented as an empty dependency graph instead of forcing
the current lockfile path to exist in that ref.

## Output Requirements

- JSON, Markdown, HTML, SARIF, and CycloneDX behavior is owned by `docs/report-formats.md`.
- Scan, diff, and explain JSON documents include `$schema` and `schemaVersion`; incompatible contract changes require a schema-version change. Schema 3.0 rejects unknown properties, separates diff classifications, and validates typed evidence and dependency-graph diagnostics alongside findings, licenses, policy summaries, waivers, thresholds, and lockfile changes. Explain JSON includes its redacted policy summary and the fixed `license-only` policy scope.
- `.ohrisk-waivers.json` has its own closed Draft 2020-12 input contract at `schemas/waiver-file.schema.json`; the parser and schema both reject unknown root and item fields.
- Shareable formats must not expose absolute local project roots, lockfiles, policy paths, cache paths, or credentials.
- Machine-readable IDs, fingerprints, enum values, and paths must remain stable unless the change is documented and tested.

## Configuration Boundaries

Policy inheritance, package exceptions, and registry settings are owned by
`docs/policy.md`. Cache layout, offline behavior, host allowlists, and token
scoping are owned by `docs/cache-and-registries.md` and
`docs/remote-fetching.md`.

## Validation

- Run `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun test` for CLI behavior changes.
- Run `bun run test:coverage` when parser, policy, evidence, or report branches change.
- Run `bun run verify:release` for package, bundled Action, schema, documentation, or published CLI surface changes.
