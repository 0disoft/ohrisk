# Changelog

## 0.160.11 - 2026-06-28

- Delayed evidence-collection ETA output on larger scans until enough packages
  have completed for a steadier estimate, while keeping elapsed time and package
  progress visible from the first package.

## 0.160.10 - 2026-06-28

- Added a risky demo guide that shows how to run the bundled fixture and inspect
  high, review, unknown, and low findings in terminal or HTML reports.

## 0.160.9 - 2026-06-28

- Added a first-screen README Quickstart for installing Ohrisk, running an
  initial scan, opening an HTML report, and moving from local review to CI.
- Reduced duplicated README usage examples so the Usage section acts more like
  a detailed command reference after the Quickstart.

## 0.160.8 - 2026-06-28

- Added a remote fetching boundary guide that documents the current npm
  registry/tarball evidence scope, SSRF and credential URL protections,
  redirect validation, resource limits, local-cache precedence, and the checklist
  required before adding new remote registry adapters.

## 0.160.7 - 2026-06-28

- Maven `pom.xml` scans now report which local parent or imported BOM POM was
  missing when dependency versions cannot be resolved from the local `.m2`
  repository.
- Maven and Gradle package evidence warnings now name the missing Maven
  coordinate and tell users to run dependency resolution or provide a project
  `.m2/repository` cache.

## 0.160.6 - 2026-06-28

- Python `uv.lock`, `pdm.lock`, and `Pipfile.lock` scans now fail closed on
  remote VCS package source records with actionable guidance to use locked PyPI
  package records or project-contained local source paths.

## 0.160.5 - 2026-06-28

### Fixed

- `requirements.txt` scans now report unsupported remote VCS requirements with
  actionable guidance to use exact pins, exact constraint pins, or
  project-contained local source paths.

## 0.160.4 - 2026-06-28

### Added

- README usage now includes a beginner Windows PowerShell flow for updating the
  global CLI, checking the installed version, writing an HTML report, seeing the
  saved file path, and opening the report with `--open`.

## 0.160.3 - 2026-06-28

### Fixed

- `--open` on Windows now launches HTML report URLs through the default URL
  handler instead of relying on `explorer.exe` URL handling.

## 0.160.2 - 2026-06-28

### Added

- HTML reports now include a first-screen review summary with derived status,
  active finding counts, scan scope, waiver drift status, and review focus.

## 0.160.1 - 2026-06-28

### Fixed

- `--open` on Windows now waits for the browser request instead of treating an
  `explorer.exe` non-zero exit status alone as a report-open failure.

## 0.160.0 - 2026-06-27

### Added

- `scan` and `ci` now accept `--open` with `--html --output <file>` to open
  the generated browser report after the report file is written. Reports open
  through a temporary `127.0.0.1` URL so browser extension file URL permissions
  are not required.

## 0.159.3 - 2026-06-27

### Fixed

- HTML reports now render active findings as filterable detail cards instead
  of a wide table, keeping long paths and fingerprints readable in narrow
  browser windows.

## 0.159.2 - 2026-06-27

### Added

- `scan` and `ci` now print a stage-based progress bar to stderr when
  `--output` is used, so long-running report generation shows visible progress
  without mixing status text into the report file.

## 0.159.1 - 2026-06-27

### Fixed

- `--output` now prints the resolved report path after a successful file write,
  so users can find generated JSON, Markdown, HTML, SARIF, or CycloneDX reports.

## 0.159.0 - 2026-06-27

### Added

- `ohrisk scan` and `ohrisk ci` now support `--html` for browser-friendly
  local reports with the same findings, waiver summaries, and next-action
  guidance as the human-readable scan output.

## 0.158.16 - 2026-06-25

### Fixed

- CycloneDX JSON SBOMs with duplicate dependency entries for the same `ref`
  now merge child edges instead of letting the later entry drop earlier
  dependency paths.

## 0.158.15 - 2026-06-25

### Fixed

- SPDX tag-value SBOMs with malformed `DESCRIBES` relationships now report
  structured unsupported relationship details instead of silently changing root
  inference.

## 0.158.14 - 2026-06-25

### Fixed

- SPDX RDF/XML SBOMs with malformed `DESCRIBES` relationships now report
  structured unsupported relationship details instead of silently changing root
  inference.

## 0.158.13 - 2026-06-25

### Fixed

- SPDX JSON SBOMs with malformed `DESCRIBES` relationships now report
  structured unsupported relationship details instead of silently changing root
  inference.

## 0.158.12 - 2026-06-25

### Fixed

- CycloneDX JSON SBOMs with non-array `dependencies` values now report
  structured unsupported dependency details instead of silently dropping edges.

## 0.158.11 - 2026-06-25

### Fixed

- SPDX JSON SBOMs with non-array `relationships` values now report structured
  unsupported relationship details instead of silently dropping dependency edges.

## 0.158.10 - 2026-06-25

### Fixed

- CycloneDX JSON SBOMs with malformed dependency entry shapes now report
  structured unsupported dependency details instead of silently dropping edges.

## 0.158.9 - 2026-06-25

### Fixed

- CycloneDX XML SBOMs with missing dependency `ref` values now report
  structured unsupported dependency details instead of silently dropping edges.

## 0.158.8 - 2026-06-25

### Fixed

- SPDX RDF SBOMs with malformed dependency relationships now report structured
  unsupported relationship details instead of silently dropping edges.

## 0.158.7 - 2026-06-25

### Fixed

- SPDX tag-value SBOMs with malformed dependency relationships now report
  structured unsupported relationship details instead of silently dropping
  edges.

## 0.158.6 - 2026-06-25

### Fixed

- SPDX JSON SBOMs with malformed dependency relationships now report structured
  unsupported relationship details instead of silently dropping edges.

## 0.158.5 - 2026-06-25

### Fixed

- CycloneDX JSON SBOMs with non-string `dependsOn` entries now report
  structured unsupported dependency details instead of silently dropping edges.

## 0.158.4 - 2026-06-25

### Fixed

- Julia `Manifest.toml` files with non-string dependency entries now report
  structured unsupported dependency details instead of silently dropping edges.

## 0.158.3 - 2026-06-25

### Fixed

- LuaRocks `luarocks.lock` files with only non-string dependency entries now
  report structured unsupported dependency details.

## 0.158.2 - 2026-06-25

### Fixed

- Haskell Stack `stack.yaml.lock` files that contain only unsupported git or
  path package entries now report structured unsupported dependency details.

## 0.158.1 - 2026-06-25

### Fixed

- Erlang Rebar3 `rebar.lock` files that contain only unsupported git or path
  dependency entries now report structured unsupported dependency details.

## 0.158.0 - 2026-06-25

### Added

- Python `uv.lock` scans now read project-root-contained `directory` and
  `editable` package source records with local Python source metadata and
  license evidence.

## 0.157.0 - 2026-06-25

### Added

- Python `pylock.toml` and named `pylock.<name>.toml` scans now read
  project-root-contained source-tree package records with local Python
  source metadata and license evidence.

## 0.156.0 - 2026-06-25

### Added

- Erlang Rebar3 `rebar.lock` scans now classify depth-0 Hex package pins
  as production root dependencies.

## 0.155.0 - 2026-06-25

### Added

- Elixir Mix `mix.lock` scans now read adjacent root `mix.exs` literal
  `only:` dependency options to classify production and development
  dependency roots.

## 0.154.0 - 2026-06-25

### Added

- R `renv.lock` scans now read adjacent root `DESCRIPTION` dependency
  fields to classify production and development dependency roots.

## 0.153.0 - 2026-06-25

### Added

- Julia `Manifest.toml` scans now read adjacent `Project.toml` `[deps]`
  entries and test target `[extras]` to classify production and development
  dependency roots.

## 0.152.0 - 2026-06-25

### Added

- Ruby Bundler scans now read literal sibling `Gemfile` inline `group:` and
  `groups:` options to classify development dependencies.

## 0.151.0 - 2026-06-25

### Added

- Ruby Bundler scans now read literal sibling `Gemfile` `group ... do`
  blocks to classify development dependencies while keeping inline
  `group:` options unsupported.

## 0.150.1 - 2026-06-23

### Fixed

- Deno `deno.lock` unsupported-root diagnostics now separate JSR, remote URL,
  and other unsupported root specifiers in structured error details while
  preserving the existing combined `unsupportedRootSpecifiers` field.

## 0.150.0 - 2026-06-23

### Added

- Bazel `MODULE.bazel` scans now read license files from local Bazel registry
  `local_path` sources configured through file-based registries, while remote
  Bazel registry metadata fetching remains unsupported.

## 0.149.2 - 2026-06-23

### Fixed

- Deno `deno.lock` scans now fail closed when root JSR or remote URL
  specifiers are present, avoiding partial reports that silently omit
  unsupported Deno dependency sources.

## 0.149.1 - 2026-06-23

### Added

- Python `pyproject.toml` inputs are now discovered and scanned when no
  companion Python lockfile is present, covering exact PEP 621
  `name==version` direct dependencies and optional dependency groups while
  failing closed on ranges and direct references without resolved versions.

### Fixed

- Local artifact error details now redact credential-like URL text even when a
  malformed `file:` specifier is embedded into a filesystem path on Linux.

## 0.148.0 - 2026-06-21

### Added

- Rust `Cargo.lock` scans now read literal and wildcard-segment Cargo
  workspace member `Cargo.toml` manifests, such as `crates/*` and
  `crates/*/plugins/*`, for root dependency classification, honoring workspace
  `exclude` entries, `crate.workspace = true` dependency keys, workspace
  dependency package aliases, table-form dependency sections such as
  `[dependencies.foo]`, and baseline `diff` reads.
- Gradle dependency locking scans now discover legacy
  `gradle/dependency-locks` directories, merge their `*.lockfile` files as
  Gradle lockfile inputs, and still accept explicit
  `gradle/dependency-locks/*.lockfile` paths while preserving the project root
  name in dependency paths.
- CycloneDX JSON and SPDX JSON SBOM inputs are now accepted explicitly
  with `--lockfile <name>.cdx.json` and
  `--lockfile <name>.spdx.json`, matching the existing explicit SBOM
  suffix handling for XML, RDF/XML, and tag-value inputs.
- SPDX RDF/XML SBOM inputs are now discovered from `spdx.rdf`,
  `bom.spdx.rdf`, `sbom.spdx.rdf`, and `sbom.spdx.rdf.xml`, accepted
  explicitly with `--lockfile <name>.spdx.rdf` or
  `--lockfile <name>.spdx.rdf.xml`, and scanned for Package URL external
  refs, dependency relationships, and embedded license evidence.
- Haskell Stack `stack.yaml.lock` inputs are now discovered and scanned for
  completed Hackage package pins, using local Stack package database license
  metadata before unavailable fallback.
- Perl Carton `cpanfile.snapshot` inputs are now discovered and scanned for
  Carton snapshot v1 distribution pins, including dependency paths inferred
  from `provides` and `requirements` metadata, using local Carton cache archive
  `META.json` or `META.yml` license metadata before unavailable fallback.
- LuaRocks `luarocks.lock` inputs are now discovered and scanned for literal
  `dependencies` table package pins, using local `.rockspec` literal string
  or string-table license metadata before unavailable fallback.

## 0.147.0 - 2026-06-21

### Added

- CycloneDX XML SBOM inputs are now discovered from `bom.xml`,
  `cyclonedx.xml`, and `sbom.cdx.xml`, accepted explicitly with
  `--lockfile <name>.cdx.xml`, and scanned for Package URL identities,
  dependency relationships, and embedded license evidence.

## 0.146.0 - 2026-06-21

### Added

- SPDX tag-value `.spdx` SBOM inputs are now discovered from `sbom.spdx`
  and `bom.spdx`, accepted explicitly with `--lockfile <name>.spdx`, and
  scanned for Package URL external refs, dependency relationships, and
  embedded license evidence.

## 0.145.0 - 2026-06-21

### Added

- Python Pipenv `Pipfile.lock` scans now support project-root-contained local
  `path` entries, including editable local source packages, when the source
  tree declares package name and version metadata.
- Python PDM `pdm.lock` scans now support project-root-contained local `path`
  and relative `file:` source records with embedded package metadata and
  license evidence.
- `diff` now reads baseline Pipenv and PDM local source metadata and license
  files, so unchanged local-source license findings do not appear as new PR
  risk.

## 0.144.0 - 2026-06-21

### Added

- Python `requirements.txt` scans now support project-root-contained local
  source requirements, including editable `-e ./path` / `--editable ./path`,
  direct `./path`, `file:./path`, and `name @ file:./path` entries when the
  local source declares package name and version metadata in `pyproject.toml`,
  `setup.cfg`, or `PKG-INFO`.
- Local Python source requirement evidence is embedded from the source tree, so
  scans and diffs can evaluate `pyproject.toml` or `setup.cfg` license metadata
  plus root license files without requiring the package to be installed into
  `.venv`.

## 0.143.0 - 2026-06-21

### Added

- Go `go.work` projects are now discovered and scanned across workspace
  modules, including baseline `diff` reads for each workspace module's
  `go.mod` and optional `go.sum` file.
- Go workspace `replace` directives are applied ahead of workspace module
  `go.mod` replacements, including wildcard `go.work` replacements that
  override version-specific module replacements.

## 0.142.0 - 2026-06-21

### Added

- Go `go.mod` scans now resolve `replace` directives while preserving the
  original required module identity in findings.
- Module-to-module Go replacements use the replacement module/version for local
  Go module cache evidence, and project-root-contained local replacement paths
  are scanned for license evidence.

## 0.141.0 - 2026-06-21

### Added

- Maven `pom.xml` scans now resolve versionless direct dependencies from local
  `.m2/repository` parent POM `dependencyManagement` entries and imported BOM
  POMs when those POMs are already available locally.
- Conda `environment.yml` and `environment.yaml` projects are now discovered and
  scanned for exact Conda `name=version` pins and exact pip `name==version`
  pins.
- Gradle version catalog `gradle/libs.versions.toml` projects are now
  discovered and scanned for exact Maven library aliases.
- Bazel `MODULE.bazel` projects are now discovered and scanned for exact
  `bazel_dep` module versions.
- .NET `*.csproj` scans now resolve literal central package versions from the
  nearest `Directory.Packages.props` file.

## 0.139.0 - 2026-06-21

### Added

- Erlang Rebar3 `rebar.lock` projects are now discovered and scanned for Hex
  package pins.
- Local Hex package `rebar.config` license metadata is now used as evidence when
  `mix.exs` license metadata is unavailable.

## 0.138.0 - 2026-06-21

### Added

- Conda `conda-lock.yml` and `conda-lock.yaml` projects are now discovered and
  scanned for locked Conda and pip package records.
- Local Conda package cache `info/index.json` metadata and license files are now
  used as Conda package evidence before unavailable fallback.

## 0.137.0 - 2026-06-21

### Added

- vcpkg `vcpkg.json` manifest projects are now discovered and scanned from
  installed `vcpkg_installed/vcpkg/status` records when available, or from
  exact top-level `overrides` when installed status is absent.
- Local `vcpkg_installed/<triplet>/share/<port>/copyright` files are now used
  as vcpkg license evidence before unavailable fallback.

## 0.136.0 - 2026-06-21

### Added

- Python `pylock.toml` and named `pylock.<name>.toml` projects are now
  discovered and scanned for versioned PyPI package records, using dependency
  references in the lock file to reconstruct audit paths.
- R `renv.lock` projects are now discovered and scanned for locked package
  records, with local `renv/library` DESCRIPTION license metadata and license
  file evidence when available.
- Julia `Manifest.toml` projects are now discovered and scanned for versioned
  `[[deps.Name]]` package records, with local Julia depot `Project.toml`
  license metadata and license file evidence when available.

## 0.134.0 - 2026-06-21

### Added

- Unity Package Manager `Packages/packages-lock.json` projects are now
  discovered and scanned for locked UPM package entries, skipping Unity built-in
  modules and using local `Packages/` or `Library/PackageCache` source license
  evidence when available.

## 0.133.0 - 2026-06-21

### Added

- Terraform `.terraform.lock.hcl` inputs are now discovered and scanned for
  locked provider versions, with local `.terraform/providers` license file
  evidence when available.
- Helm `Chart.lock` and `Chart.yaml` inputs are now discovered and scanned for
  chart dependencies, with local `charts/` metadata and license file evidence
  when available.
- Nix `flake.lock` inputs are now discovered and scanned for reachable flake
  inputs, with local path-input license file evidence when available.

## 0.132.0 - 2026-06-21

### Added

- Conan 2 `conan.lock` inputs are now discovered and scanned for resolved
  recipe references from `requires`, `build_requires`, and `python_requires`
  arrays, with local Conan cache `conanfile.py` and license file evidence.

## 0.131.0 - 2026-06-21

### Added

- .NET restored `obj/project.assets.json` inputs are now discovered and scanned
  for resolved NuGet package graphs, including direct roots from
  `projectFileDependencyGroups` and transitive target dependencies.
- .NET `*.csproj` inputs are now discovered and scanned for direct literal
  `PackageReference` dependencies when package versions are declared in the
  project file.
- .NET NuGet `packages.config` inputs are now discovered and scanned for flat
  package entries with exact `version` attributes.
- Dart and Flutter `pubspec.lock` inputs are now discovered and scanned for
  concrete Pub package versions, with local Pub cache license evidence.
- Swift Package Manager `Package.resolved` inputs are now discovered and
  scanned for pinned packages, with local `.build/checkouts` or
  `SourcePackages/checkouts` license evidence.
- Carthage `Cartfile.resolved` inputs are now discovered and scanned for
  resolved pins, with local `Carthage/Checkouts` license evidence.
- CocoaPods `Podfile.lock` inputs are now discovered and scanned for resolved
  pods, with local `Pods/` source and `Pods/Local Podspecs` license evidence.
- Elixir Mix `mix.lock` inputs are now discovered and scanned for Hex package
  pins, with local `deps/` source and `mix.exs` license evidence.

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
