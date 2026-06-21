# Changelog

## 0.130.0 - 2026-06-21

### Added

- Rust `Cargo.lock` projects are now discovered and scanned for crates, using
  adjacent `Cargo.toml` root dependencies when available.
- Go `go.mod` projects are now discovered and scanned for modules, using
  adjacent `go.sum` entries when available.
- Local Cargo registry source and Go module cache directories are now used as
  license evidence sources before unavailable fallback.
- Python `uv.lock` projects are now discovered and scanned for PyPI packages,
  with local `.venv`/`venv` `*.dist-info/METADATA` license evidence.
- Python Pipenv `Pipfile.lock` projects are now discovered and scanned for
  exact `==version` package entries in the `default` and `develop` sections,
  using the same local `.venv`/`venv` `*.dist-info/METADATA` license evidence.
- Python PDM `pdm.lock` projects are now discovered and scanned for PyPI
  packages, using adjacent `pyproject.toml` root dependencies when available.
- Python `poetry.lock` projects are now discovered and scanned for PyPI
  packages, using adjacent `pyproject.toml` root dependencies when available.
- Pinned Python `requirements.txt` files are now discovered and scanned for
  direct PyPI package dependencies, nested `-r` requirement files, and exact
  `-c` constraint pins for ranged entries.
- Java Gradle `gradle.lockfile` projects are now discovered and scanned for
  Maven coordinates, with local `.m2/repository` POM license evidence.
- Java Maven `pom.xml` projects are now discovered and scanned for direct
  dependencies with explicit, property-resolved, or same-file
  `dependencyManagement` versions.
- .NET NuGet `packages.lock.json` projects are now discovered and scanned for
  direct and transitive package dependencies, with local `.nuspec` license
  evidence.
- Ruby Bundler `Gemfile.lock` projects are now discovered and scanned for gem
  dependencies, with local gemspec license evidence.
- PHP Composer `composer.lock` projects are now discovered and scanned for
  package dependencies, using adjacent `composer.json` root dependencies and
  local `vendor/` package metadata when available.
- CycloneDX JSON and SPDX JSON SBOM inputs are now discovered and scanned for
  Package URL-backed dependency identities, relationships, and embedded license
  evidence.
- License evidence can now report ecosystem metadata sources such as Python
  `METADATA`, Maven `pom.xml`, NuGet `.nuspec`, Ruby gemspec, and Composer
  `composer.json`, plus CycloneDX and SPDX SBOM metadata, without labeling them
  as `package.json` evidence.

## 0.129.0 - 2026-06-20

### Added

- pnpm `catalog:` and `catalog:<name>` dependency specifiers are now resolved
  from `pnpm-workspace.yaml` for scan and git-ref diff graph extraction.
- Yarn Berry `.yarn/cache` package zip files are now used as local package
  evidence before registry fallback, covering PnP installs without
  `node_modules`.

### Fixed

- Malformed `pnpm-workspace.yaml` catalog files now fail with a typed
  `PNPM_WORKSPACE_PARSE_FAILED` error instead of silently dropping catalog
  dependencies.

## 0.128.0 - 2026-06-20

### Added

- Yarn Berry `yarn.lock` files are now parsed alongside Yarn classic lockfiles,
  including `npm:` protocol descriptors, patched npm packages, and workspace
  package roots.

### Fixed

- Real-world Yarn workspace scans now ignore local `workspace:` packages as npm
  package evidence while still scanning each workspace package manifest as a
  dependency root.

## 0.127.1 - 2026-06-20

### Fixed

- The default Node artifact fetcher now returns DNS lookup results in the shape
  requested by Node's HTTP client, fixing `Invalid IP address: undefined`
  failures when scanning real remote package tarballs.
- Package tarball evidence now accepts npm tarballs that use a custom
  top-level directory, such as `bun/package.json`, instead of only
  `package/package.json`.
- Registry metadata fallback now requests the exact package version endpoint
  instead of the full package metadata document, avoiding oversized metadata
  failures for packages with long histories such as `@types/node`.
- Remote package tarballs that exceed Ohrisk's size limits now produce
  unavailable package evidence instead of aborting the whole repository scan.
- Package metadata now uses npm's normalized `bin` path form, avoiding publish
  auto-correction warnings for the CLI entry.

## 0.127.0 - 2026-06-20

### Fixed

- SARIF reports now use the bundled CLI version constant instead of reading
  `package.json` at runtime, so packaged npm installs can emit SARIF without
  crashing outside the source repository.
- Deno object-form npm dependency ranges such as `^4.3.0` now resolve to the
  unique matching locked package record instead of dropping the transitive
  dependency.
- Release package smoke tests now exercise the packed CLI's JSON, SARIF,
  CycloneDX, and Markdown scan outputs.
- Remote artifact fetches now follow HTTP redirects only after validating each
  target URL and DNS result, and the default Node fetch path validates the DNS
  answer used for the actual connection.
- The build step now fails when `package.json` and `src/cli/version.ts` declare
  different versions, preventing packaged CLI version drift.

## 0.126.0 - 2026-06-20

### Added

- npm `npm-shrinkwrap.json` projects are now discovered and scanned with the
  package-lock parser while preserving the shrinkwrap lockfile kind in reports.

## 0.125.0 - 2026-06-20

### Added

- Deno `deno.lock` projects are now discovered and scanned for npm package
  dependencies recorded in the lockfile.

## 0.124.0 - 2026-06-20

### Changed

- The published CLI now ships as a Node-compatible bundle, so npm, pnpm, Yarn,
  npx, pnpm dlx, and yarn dlx users can run Ohrisk without installing Bun.

## 0.123.0 - 2026-06-20

### Fixed

- npm package-lock v1 parsing now links hoisted dependencies through their requiring parents instead of treating them as direct root dependencies.

## 0.122.0 - 2026-06-20

### Fixed

- Explicit commercial-use restriction evidence now remains high risk even when package metadata declares a permissive license.

## 0.121.0 - 2026-06-20

### Fixed

- `UNLICENSE` evidence file variants such as `UNLICENSE.md` are now recognized during package license evidence collection.

## 0.120.0 - 2026-06-20

### Fixed

- Markdown scan reports now show the package/project name instead of the absolute project root, keeping PR-facing artifacts from leaking local or CI workspace paths.

## 0.119.0 - 2026-06-20

### Fixed

- `ohrisk diff` now reads and validates the requested baseline ref before collecting current package evidence, so invalid baselines fail without first touching current remote package artifacts.

## 0.118.0 - 2026-06-20

### Fixed

- Remote artifact response handling now only trusts decimal `Content-Length` values, falling back to streamed byte limits for malformed size headers.

## 0.117.0 - 2026-06-20

### Fixed

- Package tarball parsing now enforces a maximum entry count, preventing archives with excessive headers from consuming unbounded parser work inside the unpacked size limit.

## 0.116.0 - 2026-06-20

### Fixed

- Package tarball decompression is now bounded by a maximum unpacked size, preventing small compressed artifacts from expanding into oversized in-memory tar data during evidence collection.

## 0.115.0 - 2026-06-20

### Fixed

- Failed registry metadata and tarball HTTP responses now cancel their response bodies without waiting for cleanup, so error responses do not leave unread artifact streams behind.

## 0.114.0 - 2026-06-20

### Fixed

- Artifact response cancellation no longer blocks scan failures when a stream's `cancel()` handler stalls, so oversized registry metadata and tarball responses fail promptly after cleanup has been requested.

## 0.113.0 - 2026-06-20

### Fixed

- Oversized registry metadata and tarball responses are now cancelled when their `Content-Length` exceeds Ohrisk's configured response limit, so rejected streamed responses do not stay open after the scan moves on.

## 0.112.0 - 2026-06-20

### Fixed

- Remote artifact body streams are now cancelled when the artifact fetch timeout fires, preventing stalled response readers from surviving after the CLI has already reported a timeout.

## 0.111.0 - 2026-06-20

### Fixed

- Artifact fetch diagnostic causes now redact credential-like URL text before surfacing errors.

## 0.110.0 - 2026-06-20

### Fixed

- Local artifact error details now redact credential-like URL text from resolved specifiers, derived artifact paths, and diagnostic causes.

## 0.109.0 - 2026-06-20

### Fixed

- Remote artifact URLs with embedded credentials are now rejected before fetch, and credential-bearing URL fields are redacted in error details.

## 0.108.0 - 2026-06-20

### Fixed

- Remote artifact IPv6 host checks now reject additional special-purpose ranges such as local-use NAT64, discard-only, Teredo, benchmarking, and ORCHID addresses before fetch.

## 0.107.0 - 2026-06-20

### Fixed

- IPv6 artifact hosts that embed IPv4 addresses through NAT64, 6to4, or IPv4-compatible forms now reuse the IPv4 host block policy before fetch.

## 0.106.0 - 2026-06-20

### Fixed

- IPv4-mapped IPv6 artifact hosts now classify their embedded IPv4 address before fetch, so mapped loopback and private addresses are rejected with the same host policy as ordinary IPv4 literals.

## 0.105.0 - 2026-06-20

### Fixed

- Remote artifact fetches now resolve hostname targets before fetch and reject DNS answers that point at localhost, private, link-local, or reserved network addresses.

## 0.104.0 - 2026-06-20

### Fixed

- Remote artifact fetches now request manual redirect handling so tarball URLs cannot be silently followed to another host.

## 0.103.0 - 2026-06-20

### Fixed

- Remote package tarball URLs now reject obvious localhost, private, link-local, and reserved host targets before fetch.

## 0.102.0 - 2026-06-20

### Fixed

- Remote registry metadata and tarball reads now require a readable response body stream instead of falling back to unbounded `arrayBuffer()` reads.

## 0.101.0 - 2026-06-20

### Fixed

- Waiver files and installed `node_modules` package metadata checks now use bounded reads before parsing or trusting package evidence.

## 0.100.0 - 2026-06-20

### Fixed

- Project lockfile reads now enforce maximum input sizes before parsing Bun, npm, pnpm, and Yarn lockfiles, including Yarn root and workspace package manifests.

## 0.99.0 - 2026-06-20

### Fixed

- Local package directory evidence now bounds `package.json` and license evidence file reads, preventing oversized local metadata or NOTICE/LICENSE files from being loaded into memory.

## 0.98.0 - 2026-06-20

### Fixed

- Local package tarball evidence now enforces the same maximum artifact size before reading bytes, preventing oversized `file:` artifacts from being loaded into memory.

## 0.97.0 - 2026-06-19

### Fixed

- Remote registry metadata and tarball evidence reads now enforce bounded response sizes, preventing oversized artifact responses from being loaded into memory during scans.

## 0.96.0 - 2026-06-19

### Fixed

- Remote evidence timeouts now cover response body reads as well as the initial fetch, preventing scans from hanging after response headers arrive.

## 0.95.0 - 2026-06-19

### Fixed

- Remote registry and tarball evidence fetches now use a bounded timeout so stalled network reads fail honestly instead of hanging scans indefinitely.

## 0.94.0 - 2026-06-19

### Fixed

- Registry metadata now fails clearly when it advertises a non-HTTP tarball URL instead of treating package evidence as silently unavailable.

## 0.93.0 - 2026-06-19

### Fixed

- Package tarball parsing now rejects entries with invalid tar header checksums before trusting package metadata.

## 0.92.0 - 2026-06-19

### Fixed

- Package tarball parsing now rejects entries whose declared size extends beyond the archive data before trusting package metadata.

## 0.91.0 - 2026-06-19

### Fixed

- CycloneDX SBOM metadata now avoids exposing local project root and lockfile absolute paths in CI artifacts.

## 0.90.0 - 2026-06-19

### Fixed

- Git baseline read failures now refer to the failed baseline file, not only lockfiles, because the same reader also loads Yarn workspace manifests during diff scans.

## 0.89.0 - 2026-06-19

### Fixed

- Command-specific help output now lists the supported `--help` and `-h` flags for every help target.

## 0.88.0 - 2026-06-19

### Fixed

- Kept the exported `OhriskErrorCode` type aligned with every runtime error code emitted by lockfile and workspace parsing paths.

## 0.87.0 - 2026-06-19

### Fixed

- Git baseline reads now report missing files separately from other git ref failures, allowing newly added Yarn workspaces to diff cleanly without hiding non-missing baseline read errors.

## 0.86.0 - 2026-06-19

### Fixed

- Git baseline reads now reject lockfile paths that escape the current project root, preventing diff baselines from reading sibling repository files.

## 0.85.0 - 2026-06-19

### Fixed

- Git baseline reads now stop option parsing before the refspec, preventing option-like refs from being misread as successful baseline file contents.

## 0.84.0 - 2026-06-19

### Fixed

- Yarn workspace discovery now ignores workspace patterns that resolve outside the project root instead of scanning sibling directories as project roots.

## 0.83.0 - 2026-06-19

### Fixed

- URL-encoded `file:` dependency artifact paths now resolve to the decoded local path before reading package evidence.

## 0.82.0 - 2026-06-19

### Fixed

- `node_modules` evidence lookup now rejects invalid package names before resolving paths, preventing malformed lockfile package names from escaping the `node_modules` directory.

## 0.81.0 - 2026-06-19

### Fixed

- Local package directories and package tarballs now reject non-object `package.json` metadata as package metadata failures instead of accepting arrays as empty package records.

## 0.80.0 - 2026-06-19

### Fixed

- `node_modules` package evidence is now used only when the installed package name and version match the lockfile node, preventing stale installs from masking the license evidence for the locked package version.
- Bun local tarball lock entries now preserve the artifact reference, dependency metadata, and integrity from Bun's three-field tuple shape.

## 0.79.0 - 2026-06-19

### Fixed

- `ohrisk diff` now reads Yarn v1 workspace package manifests from the baseline git ref so unchanged workspace dependency risks are not reported as new findings.

## 0.78.0 - 2026-06-19

### Fixed

- Yarn v1 workspace package manifests are now scanned as dependency roots instead of relying only on the root `package.json`.

## 0.77.0 - 2026-06-19

### Fixed

- npm `package-lock.json` workspace package entries now scan their own dependency roots instead of relying only on the root package dependencies.

## 0.76.0 - 2026-06-19

### Fixed

- Bun workspace lockfiles and pnpm workspace lockfiles now scan dependencies from every workspace/importer entry instead of only the root or first entry.

## 0.75.0 - 2026-06-19

### Fixed

- CycloneDX SBOM dependency relationships now preserve child edges when dependency paths contain npm alias segments such as `compat-parent -> actual-package@1.0.0`.

## 0.74.0 - 2026-06-19

### Fixed

- License files containing `SPDX-License-Identifier:` now provide medium-confidence SPDX expression evidence instead of falling through as custom text.

## 0.73.0 - 2026-06-19

### Fixed

- Tarball evidence collection now ignores nested license-like files such as `vendor/LICENSE` so vendored fixtures or examples are not mistaken for the package's own license evidence.

## 0.72.0 - 2026-06-19

### Fixed

- Slash- and comma-separated package license shorthands such as `MIT/Apache-2.0` and `MIT, Apache-2.0` now normalize as `OR` choices instead of falling through as malformed metadata.

## 0.71.0 - 2026-06-19

### Fixed

- Source-available shorthand license expressions such as `BUSL`, `SSPL`, and `Elastic License` now normalize to high-risk source-available licenses instead of falling through as unknown identifiers.

## 0.70.0 - 2026-06-19

### Fixed

- Options that require values now reject the next option token instead of treating it as a file path, profile, lockfile path, or threshold value.

## 0.69.0 - 2026-06-19

### Fixed

- Markdown scan and diff reports now preserve table structure when dynamic fields contain backticks, pipes, or newlines.
- Markdown report escaping is shared across scan and diff output to prevent formatter drift.

## 0.68.0 - 2026-06-19

### Fixed

- Malformed `package.json` files inside package tarballs now report package metadata parse failures instead of generic tarball parse failures.

## 0.67.0 - 2026-06-19

### Fixed

- Registry metadata JSON parse failures now report unsupported input instead of a network read failure.

## 0.66.0 - 2026-06-19

### Fixed

- Integrity verification now rejects malformed or wrong-length SRI digests before comparing package tarball bytes.

## 0.65.0 - 2026-06-19

### Fixed

- Project discovery now ignores directories that use supported lockfile names and reports explicit lockfile directory paths as invalid input.

## 0.64.0 - 2026-06-19

### Added

- `scan`, `ci`, and `diff` now accept `--lockfile <path>` so projects with multiple supported lockfiles can select the intended lockfile explicitly.

## 0.63.0 - 2026-06-19

### Fixed

- Legacy `package-lock.json` v1 parsing now preserves nested optional dependency flags instead of inheriting production scope from the parent.

## 0.62.0 - 2026-06-19

### Fixed

- Bun lockfile parsing now preserves nested optional and peer dependency edges instead of reporting them as production edges.

## 0.61.0 - 2026-06-19

### Fixed

- `pnpm-lock.yaml` parsing now preserves nested optional and peer dependency edges from package snapshots.
- Yarn v1 lockfile parsing now preserves nested optional dependency edges instead of reporting them as production edges.

## 0.60.0 - 2026-06-19

### Fixed

- Modern `package-lock.json` parsing now preserves nested `optionalDependencies` and `peerDependencies` edges instead of dropping those transitive packages.

## 0.59.0 - 2026-06-19

### Added

- Release verification now installs the packed tarball into a temporary consumer project and smoke-tests the packaged `ohrisk` bin with `version` and `scan --json`.
- Usage documentation now shows the installed `ohrisk` CLI command instead of source-tree development commands.

## 0.58.0 - 2026-06-19

### Added

- Command-specific help is now also available through `ohrisk <command> --help` and `ohrisk <command> -h`.

## 0.57.0 - 2026-06-19

### Added

- `ohrisk help <command>` now prints command-specific usage and option details for `scan`, `ci`, `diff`, `explain`, `help`, and `version`.

## 0.56.0 - 2026-06-19

### Added

- License evidence collection now recognizes `UNLICENSE` plus hyphen and underscore variants such as `LICENSE-MIT`, `LICENCE_APACHE`, `COPYING-LESSER`, and `NOTICE_THIRD_PARTY`.

## 0.55.1 - 2026-06-19

### Fixed

- Commercial restriction signals no longer override parseable `OR` license choices when a lower-risk branch is available.

## 0.55.0 - 2026-06-19

### Added

- License normalization now recognizes common source-available restriction aliases such as Commons Clause, BUSL, SSPL, Elastic License, and PolyForm variants.
- Package metadata license strings with explicit commercial-use restrictions now produce high-risk commercial restriction signals.

## 0.54.0 - 2026-06-19

### Added

- CycloneDX SBOM components now include active Ohrisk risk decision properties for audit workflows.
- CycloneDX SBOM metadata now includes the Ohrisk waiver mode.

## 0.53.0 - 2026-06-19

### Added

- Reports now expose waiver mode so raw `--no-waivers` audits are distinguishable from normal local waiver scans.

## 0.52.1 - 2026-06-19

### Fixed

- README report examples now match the current terminal and Markdown fingerprint output.

## 0.52.0 - 2026-06-19

First public release candidate for Ohrisk.

### Added

- `ohrisk scan` for local Bun `bun.lock` projects.
- `package-lock.json` graph parsing for modern npm lockfiles with a `packages` section.
- npm v1 `package-lock.json` dependency-tree parsing.
- `pnpm-lock.yaml` graph parsing for importer, package, and snapshot dependency data.
- Yarn v1 `yarn.lock` graph parsing with root dependency classification from `package.json`.
- `--profile saas` and `--profile distributed-app` risk profiles.
- `--prod` filtering that excludes development-only dependencies while keeping production-relevant optional and peer dependency risk visible.
- `--json` output that reuses the terminal report finding model.
- `--sarif` output for SARIF 2.1.0 code scanning upload.
- `--markdown` output for PR comments and release notes.
- `--cyclonedx` output for CycloneDX 1.5 JSON SBOMs.
- Diff reports surface new or changed NOTICE and attribution work as the next action.
- `--output <file>` for writing scan, ci, diff, and explain reports to disk.
- `ohrisk ci --fail-on <severity>` for non-zero exits when findings meet a configured threshold.
- `ohrisk ci --strict-waivers` for non-zero exits when local waivers are expired or unmatched.
- `ohrisk scan --no-waivers` and `ohrisk ci --no-waivers` for raw audits that ignore local waiver files.
- `ohrisk explain <license-expression>` for profile-aware license risk explanation without scanning a project.
- `ohrisk diff <baseline-ref>` for git-ref baseline comparison that reports only new or meaningfully changed findings.
- `--version` and `-v` package version output.
- `help` and `version` command aliases for the global CLI.
- Unknown option errors list the supported `--help` and `-h` aliases.
- Diff output-format conflict errors no longer advertise unsupported SARIF output.
- Top-level `help` and `version` aliases validate trailing arguments instead of silently ignoring them.
- Help output and README examples document the supported `help <command>` shape.
- Project discovery with clear failures for unsupported or ambiguous lockfiles.
- Bun lockfile dependency graph parsing with direct, transitive, production, and development dependency context.
- Local `file:` package evidence collection.
- Installed `node_modules` package evidence collection before network fallback.
- HTTP(S) tarball evidence collection when the lockfile points directly to a tarball.
- npm registry metadata lookup when the lockfile does not contain a direct tarball URL.
- `package.json` license field, legacy `licenses` field, `LICENSE`, `LICENCE`, `COPYING`, and `NOTICE` evidence handling.
- SPDX-like license expression parsing with simple `AND` and `OR` handling.
- SPDX `WITH` exception handling, deprecated package license object handling, and explicit `UNLICENSED` risk classification.
- Common human-readable license metadata aliases such as `Apache License, Version 2.0`, `BSD 2-Clause`, and `ISC License` are normalized.
- Common permissive and public-domain-style SPDX licenses `0BSD`, `CC0-1.0`, and `Unlicense` are classified as low risk.
- NOTICE evidence is surfaced as attribution-preservation action text without raising severity.
- Source-available restriction licenses `Elastic-2.0`, `PolyForm-Noncommercial-1.0.0`, and `PolyForm-Free-Trial-1.0.0` are classified as high risk.
- `Zlib` is classified as a low-risk permissive license.
- Explicit commercial restriction text detection for Commons Clause, BUSL, and non-commercial license evidence.
- `UNLICENSED` packages get specific reason and action text instead of generic high-risk wording.
- Source-available restriction licenses get specific high-risk reason text.
- Recognizable standard license text in `LICENSE` and `COPYING` files is used as medium-confidence evidence when package license metadata is absent.
- Recognizable standard license files can resolve malformed package metadata pointers such as `SEE LICENSE IN LICENSE`.
- Standard license file detection covers `Unlicense` and `CC0-1.0` public-domain-style text.
- Standard license file detection covers Zlib license text.
- Standard license file detection covers GPL-2.0, LGPL-2.0, and LGPL-2.1 text in addition to existing GPL-family v3 detection.
- Specific finding reason text for explicit commercial-use restriction evidence.
- Markdown scan and diff reports include finding reasons for PR review.
- Findings include human-readable action text alongside the stable recommendation enum.
- Findings include stable IDs for JSON, terminal, Markdown, SARIF, and diff matching.
- Diff matching ignores reason and evidence prose churn while still surfacing severity, recommendation, or action changes.
- Findings include exact fingerprints for SARIF partial fingerprints and downstream audit trails.
- Terminal and Markdown scan, CI, and diff reports include finding fingerprints for waiver and audit workflows.
- npm alias dependencies resolve to the actual package identity while keeping the alias visible in dependency paths.
- Installed `node_modules` evidence lookup checks npm alias install names before registry fallback.
- pnpm alias package keys such as `alias@npm:actual@version` resolve to the actual package identity.
- Local and remote package tarballs are verified against lockfile integrity digests before license evidence is trusted.
- SARIF result properties include structured reason and action fields.
- Markdown scan reports include license confidence counts.
- Terminal and Markdown scan summaries include missing and malformed license counts.
- Risk findings include structured dependency type and direct/transitive scope.
- Scan and diff reports choose the next action from the actual finding recommendations.
- JSON scan and diff reports include the same next action used by human-readable reports.
- JSON reports include `failOn`, `failed`, and `failingFindingCount` when a CI or diff threshold is configured.
- Terminal and Markdown reports show threshold pass/fail lines when a CI or diff threshold is configured.
- `.ohrisk-waivers.json` local waivers by finding ID or fingerprint.
- Scan and CI JSON, terminal, and Markdown reports separate active findings from waived findings.
- SARIF reports include waived findings as externally suppressed results with waiver reason metadata.
- Expired local waivers are reported with target, reason, and expiry date without being applied.
- Unmatched active waivers are reported with target and reason without being applied.
- JSON, terminal, Markdown, and SARIF reports show strict waiver drift status when `ci --strict-waivers` is enabled.
- Unknown-risk findings now distinguish missing, malformed, and unrecognized license metadata in reason and action text.
- Risk findings for low, review, high, and unknown license evidence.
- Terminal findings sorted by severity with package path, recommendation, and evidence snippets.

### Not Included Yet

- Central approval or legal workflow management.
- GitHub App integration.
- Ecosystem adapters beyond npm-style lockfiles.
