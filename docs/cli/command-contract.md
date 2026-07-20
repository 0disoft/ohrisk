# Command Contract

- Status: Project-owned
- Repository Type: cli-tool

## Runtime

The published CLI runs on Node.js `>=24.0.0`. Bun is used for repository
development, tests, and packaging.

## Commands

| Command | Contract |
| --- | --- |
| `ohrisk scan` | Scan local, archive, or supported public GitHub repository dependency evidence and render a non-failing report unless input preparation or output/write fails. |
| `ohrisk ci` | Run a scan and exit non-zero when active findings meet `--fail-on` after waiver handling. |
| `ohrisk diff <ref>` | Compare findings against a git baseline and classify new, meaningfully changed, and resolved risk. |
| `ohrisk explain <expr>` | Classify one license expression for the selected profile without scanning a project; `--policy` applies license-level organization rules only. |
| `ohrisk cache status|prune|clear` | Inspect or clean the persistent artifact cache without scanning a project. |

## Stable Options

- `--lockfile <path>` selects one supported input; `--all` discovers and merges all supported lockfiles at the selected project root. They are mutually exclusive for scan, CI, and diff. A remote repository scan automatically merges multiple supported inputs at its one selected project root; local, archive, CI, and diff inputs keep the explicit `--all` opt-in.
- `scan|ci --archive <path>` scans a ZIP, TAR, TAR.GZ, or TGZ as a read-only in-memory virtual project. It is mutually exclusive with `--lockfile` and `--workspace-root`, may be combined with `--all`, and is not supported by `diff`.
- `scan [repository-url]` and `scan --repo <url>` scan one public GitHub HTTPS repository through a bounded temporary shallow clone. Remote repository input may combine with a safe repository-relative `--lockfile`, is mutually exclusive with `--archive`, `--workspace-root`, and `--offline`, and is not supported by `ci`, `diff`, or the GitHub Action input contract.
- `--policy <path>` selects a workspace-contained policy file; otherwise `.ohrisk.yml` is loaded when present.
- `explain --policy <path>` accepts `--workspace-root <path>` for the inheritance boundary. It reports policy sources as relative paths and never applies package rules because explain has no package identity.
- `--profile saas|distributed-app` selects the shipping model, with organization policy overrides applied afterward.
- `--prod` narrows scans to production-relevant dependencies when supported by the input ecosystem.
- `--fail-on unknown|review|high|low` controls CI failure threshold.
- `--json`, `--markdown`, `--html`, `--sarif`, and `--cyclonedx` select report formats.
- `--output <path>` writes a report artifact.
- A remote repository scan with `--html` and no explicit `--output` writes `<repository>-ohrisk.html` under the invocation directory. Local and archive HTML scans keep their existing stdout behavior.
- `--submodules ignore|reject` controls remote Git submodule gitlinks. The default `ignore` mode reports incomplete coverage without fetching submodules; `reject` fails on the first submodule path.
- `--language <locale>` localizes HTML report chrome and Ohrisk-generated review text.
- `--no-waivers` ignores local waiver files; `--strict-waivers` fails on expired or unmatched waivers.
- `--offline` forbids network requests and permits only local or verified cached evidence.
- `--cache-dir <path>`, `--jobs <1..64>`, and `--timeout <duration>` configure persistent cache location and bounded evidence collection.
- `cache status|prune|clear` accepts `--cache-dir` and `--json`; `cache prune` also accepts `--max-size <bytes>` and `--max-age <duration>`.
- `--registry-url <https-url>`, `--registry-token-env <name>`, and repeatable `--allow-host <hostname>` configure a private npm-compatible registry without accepting raw token arguments. `--allow-host` also permits an exact matching HTTPS Maven repository already declared by the scanned project; it never invents a repository URL or permits arbitrary Maven hosts.

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

## Remote Repository Input

Remote repository input accepts only `https://github.com/<owner>/<repository>[.git]` without
credentials, ports, query strings, fragments, encoded path components, or extra path segments.
Private repositories and alternate Git hosts or protocols are not supported. Ohrisk invokes Git
from `PATH` without a shell or interactive credential prompt, uses a depth-one single-branch clone, disables
submodule recursion and symlink checkout, inspects the Git tree before checkout, and removes its
owned temporary directory after success or failure.

Symbolic-link entries are never followed. Ohrisk records their safe repository-relative paths,
removes their checkout materializations before project discovery, verifies that no symbolic link
or unexpected special entry remains, and marks every report as incomplete coverage. A symbolic
link cannot supply a lockfile or manifest.

When a repository has no supported input at its root, Ohrisk searches only
inside the validated checkout. It automatically selects one nested dependency
project, or merges every supported input across multiple nested project roots
for a repository-wide scan. For example, a plain Mbed TLS scan selects
`docs/requirements.txt`, while an Ente-style monorepo keeps `mobile`, `server`,
and `web` inputs in one graph with per-lockfile provenance. Automatic fan-out is
limited to 64 project roots and 128 dependency inputs. `--lockfile` still narrows
the scan to one explicitly selected repository-relative input. Inputs at each
selected root are merged without preferring one ecosystem and silently omitting
the others. Standalone `pyproject.toml` manifests participate in automatic
discovery only when their dependency entries are exact `name==version` pins;
ranges and direct references require a resolved lockfile and are not treated as
concrete automatic inputs.
SBOM files containing unresolved uppercase `@BUILD_VARIABLE@` placeholders are
treated as build templates rather than concrete automatic-discovery candidates.
Absolute, empty-segment, dot-segment, and traversal paths are rejected before
resolution inside the validated temporary checkout.

The pre-checkout tree allows at most 50,000 entries, 100 MiB per blob, 640 MiB total blob
content, 4,096 UTF-8 bytes and 64 segments per path, and 255 UTF-8 bytes per segment. Symbolic
links are skipped without following their targets. Regular files with Windows-reserved names,
unsupported characters or suffixes, overlong segments, or case/Unicode normalization collisions
are excluded through a NUL-delimited literal Git pathspec before checkout and reported as
non-portable paths. Structural traversal, `.git` segments, and other special entries are rejected.
Submodule gitlinks are skipped without fetching in the
default `--submodules ignore` mode. Reports include the total skipped count, at most 100 safe
relative paths for each skipped entry type, including non-portable files, and whether each path list was truncated;
`--submodules reject` instead
fails with the first detected path. Temporary clone storage is capped at 1 GiB and the full
operation uses separate hard stage budgets: two minutes for clone, 30 seconds for tree inspection,
and three minutes for checkout. These are fail-closed limits, not
truncation rules.

When no supported dependency manifest, lockfile, or SBOM exists, `NO_SUPPORTED_LOCKFILE` reports
that no dependency project was detected and points to `ohrisk help scan`; it does not print the
entire supported-input catalog. A detected project manifest without a lockfile receives a distinct
message telling the user to add or select a supported lockfile.

Policy and waiver files in the cloned repository are untrusted and are not auto-loaded. The
directory where Ohrisk was invoked remains the configuration, waiver, cache, and report-output
root. General package-cache, install-tree, and vendored-source evidence from the temporary checkout
is disabled. Project-contained source metadata and license files explicitly referenced by a selected
Python lockfile local-source record are parser inputs and remain bounded by the validated checkout;
lockfile-embedded evidence and the bounded npm/PyPI/Maven remote package-evidence pipeline also remain
available. Shareable reports and errors redact the temporary checkout path.

## Multiple Lockfiles

`--all` only merges inputs discovered at the same project root. Package records
are deduplicated by Package URL while the original package identifier and every
contributing lockfile remain available as provenance. Conflicting package
metadata is reported instead of silently replacing the first deterministic
record.

Maven aggregator `pom.xml` inputs recursively scan project-contained `<module>`
POMs. Module paths, nesting depth, total module count, file size, cycles, and
missing module POMs fail closed. Child modules inherit matching aggregator
parent properties and `dependencyManagement`; exact reactor-internal module
dependencies are excluded from the external package graph. External parent and
imported BOM resolution for dependency versions remains limited to already
available local Maven repository POMs. Package license evidence may fall back to
exact-version Maven Central POMs and a bounded inherited parent-POM chain.

`diff <ref> --all` independently discovers the supported input set in the
current worktree and the baseline git tree, parses each set with the same
ecosystem adapters, and then compares their merged findings. JSON diff output
includes `lockfileChanges.current`, `baseline`, `added`, and `removed`; terminal
and Markdown output summarize added and removed inputs. JSON also separates
`newFindings`, `changedFindings`, and `resolvedFindings`, while `findings`
remains the combined new-and-changed threshold set. A baseline with no
supported input is represented as an empty dependency graph instead of forcing
the current lockfile path to exist in that ref.

For `requirements.txt`, plain pins and entries whose provenance cannot be
resolved are treated as direct dependencies. Inline or following pip-compile
`# via` annotations restore bounded parent paths when every named parent maps
unambiguously to another pin in the same parsed requirements set. A `-r` source
marks a direct requirement; a `-c` constraint alone does not. Cycles, excessive
depth, and excessive path fan-out cannot make graph reconstruction unbounded.

For `Cargo.lock`, graph traversal is iterative and retains every reachable
crate while storing at most 64 dependency paths per crate. Additional paths are
reported through a `dependency_paths_truncated` graph diagnostic rather than
expanding path combinations without a bound.

For modern npm `package-lock.json` and `npm-shrinkwrap.json`, graph traversal is
also iterative and retains every reachable package while storing at most 64
dependency paths per package. Additional paths use the same typed truncation
diagnostic instead of expanding path combinations without a bound.

For `uv.lock`, a remote Git package record is retained only when uv's resolved
source ends in a full 40- or 64-hex commit. Ohrisk does not fetch that VCS source
or substitute PyPI evidence for the same package name; the package receives
unavailable evidence and remains an `unknown` finding until the exact commit is
reviewed. Branches, tags, short revisions, unresolved URLs, and malformed remote
sources fail closed, and rejected-source diagnostics redact credentials and URL
parameters.

`uv.lock` dependency traversal is iterative and retains every reachable package
while storing at most 64 dependency paths per package. Additional paths are
reported through the same `dependency_paths_truncated` graph diagnostic used by
Cargo and modern npm graphs, preventing combinatorial path expansion from
inflating finding identities and reports without silently dropping packages.

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
