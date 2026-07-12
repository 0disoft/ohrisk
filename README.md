# Ohrisk

Ohrisk catches open-source license risk before your PR ships.

It is a local CLI for developers who need a quick answer to questions like:

- Did this dependency bring in AGPL, GPL, BUSL, or unknown license evidence?
- Is the risky package production-relevant or dev-only?
- Which parent package introduced the transitive risk?
- Does the answer change for SaaS versus distributed app usage?

Ohrisk is a risk decision aid, not legal advice. It reports `low`, `review`,
`high`, and `unknown` findings for the selected usage profile.

## Quickstart

Install and run your first scan in under a minute:

```bash
npm install -g ohrisk@1.1.3
cd your-project
ohrisk scan
```

The terminal report shows findings sorted by severity:

```text
Risks: 1 high, 1 review, 1 unknown, 2 low
```

- `high` — replace or escalate before shipping
- `review` — check before shipping under the selected profile
- `unknown` — license evidence is missing or unrecognized
- `low` — known low-risk license expression

Gate a production SaaS build by narrowing to production dependencies and the SaaS usage profile:

```bash
ohrisk scan --profile saas --prod
```

Open a browser-friendly HTML report:

```bash
ohrisk scan --html --output ohrisk-report.html --open
```

Use Korean, Spanish, French, Chinese, Hindi, Japanese, Indonesian, Turkish, Russian, or German HTML report text when you want a local review artifact for those readers:

```bash
ohrisk scan --html --language ko --output ohrisk-report.html --open
ohrisk scan --html --language es --output ohrisk-report-es.html --open
ohrisk scan --html --language fr --output ohrisk-report-fr.html --open
ohrisk scan --html --language zh --output ohrisk-report-zh.html --open
ohrisk scan --html --language hi --output ohrisk-report-hi.html --open
ohrisk scan --html --language ja --output ohrisk-report-ja.html --open
ohrisk scan --html --language id --output ohrisk-report-id.html --open
ohrisk scan --html --language tr --output ohrisk-report-tr.html --open
ohrisk scan --html --language ru --output ohrisk-report-ru.html --open
ohrisk scan --html --language de --output ohrisk-report-de.html --open
```

Prefer not to install globally? Use `npx ohrisk scan` instead.

Ready to gate PRs? Run `ohrisk ci --fail-on high` locally, or see the [GitHub Actions guide](https://github.com/0disoft/ohrisk/blob/main/docs/github-actions.md) to wire it into CI.

## When to use it

Run Ohrisk when you are about to add or upgrade a dependency and want a fast,
local read on whether the license evidence introduces risk for your shipping
model. It sits between "I just installed a package" and "legal review."

- before opening a PR that adds or changes dependencies
- before cutting a release or tagging a build
- when a transitive dependency surprise appears in a lockfile diff
- when you need a SARIF or SBOM artifact for a compliance pipeline

Ohrisk does not approve or block packages on its own. It gives you the
evidence and a profile-aware severity so you can decide.

## Commands

| Command | What it answers |
| --- | --- |
| `ohrisk scan` | What does my dependency tree look like right now? Non-failing local decision aid. |
| `ohrisk ci` | Should this PR fail the build? Runs a scan and exits non-zero when findings meet `--fail-on`. |
| `ohrisk diff <ref>` | What changed since the baseline git ref? Surfaces only new or meaningfully changed findings. |
| `ohrisk explain <expr>` | How would Ohrisk classify this license expression for a profile, without scanning a project? |

## Usage profiles

Ohrisk evaluates the same dependency tree differently depending on how you ship
software, because redistribution changes license obligations.

- `saas` (default): you run the service and do not redistribute the package
  binaries to users. GPL-only copyleft such as GPL-2.0 and GPL-3.0 is treated
  as `review` rather than an immediate block, because SaaS usage does not
  trigger redistribution obligations. AGPL and source-available restrictions
  remain `high`.
- `distributed-app`: you ship the package to users. GPL becomes `high` because
  redistribution obligations apply. Weak copyleft (LGPL, MPL, EPL) is flagged as
  `review`.

Pick the profile that matches how the dependency reaches your users:

```bash
ohrisk scan --profile saas
ohrisk scan --profile distributed-app
```

## Runtime

Ohrisk is distributed as an npm package, and the packaged CLI runs on Node.js
`>=24.0.0`. Bun is used for Ohrisk development, tests, and packaging, but users
do not need Bun installed to run the published CLI.

Ohrisk scans dependency-free `package.json` manifests, Bun, npm package-lock/shrinkwrap, pnpm, Deno npm, Yarn, Rust Cargo,
Go modules and workspaces, Python pyproject/pylock/uv/Pipenv/PDM/Poetry/requirements.txt, Java Gradle lockfiles and version catalogs,
Maven `pom.xml`, Bazel `MODULE.bazel`, .NET NuGet lockfiles, Conan locks, Conda environment specs and locks, vcpkg manifests, Haskell Stack locks, Perl Carton snapshots, LuaRocks locks, Dart/Flutter Pub locks,
Terraform provider locks, Helm chart dependency metadata, Nix flake locks,
Unity Package Manager locks, R renv locks, Julia manifests, SwiftPM pins,
Carthage pins, CocoaPods locks, Elixir Mix locks, Erlang Rebar3 locks, Ruby Bundler lockfiles, and PHP Composer lockfiles, plus
CycloneDX JSON/XML, SPDX JSON/RDF, and SPDX tag-value SBOM inputs, regardless of which
package manager you use to install the CLI.

## Current Scope

The current implementation is the first local dependency-risk vertical slice:

- dependency-free `package.json` manifests, Bun `bun.lock`, npm `package-lock.json`, npm `npm-shrinkwrap.json`, pnpm `pnpm-lock.yaml`, Deno `deno.lock`, Rust `Cargo.lock`, Go `go.work`, Go `go.mod`, Python `pyproject.toml`, Python `pylock.toml`, named Python `pylock.<name>.toml`, Python `uv.lock`, Python Pipenv `Pipfile.lock`, Python PDM `pdm.lock`, Python `poetry.lock`, Python `requirements.txt`, Java Gradle `gradle.lockfile`, Java Gradle `gradle/dependency-locks` directories and `gradle/dependency-locks/*.lockfile`, Java Gradle `gradle/libs.versions.toml`, Java Maven `pom.xml`, Bazel `MODULE.bazel`, .NET NuGet `packages.lock.json`, .NET restored `obj/project.assets.json`, .NET NuGet `packages.config`, .NET `*.csproj`, Conan `conan.lock`, Conda `environment.yml`, Conda `environment.yaml`, Conda `conda-lock.yml`, Conda `conda-lock.yaml`, vcpkg `vcpkg.json`, Terraform `.terraform.lock.hcl`, Helm `Chart.lock`, Helm `Chart.yaml`, Nix `flake.lock`, Unity Package Manager `Packages/packages-lock.json`, R `renv.lock`, Julia `Manifest.toml`, Haskell Stack `stack.yaml.lock`, Perl Carton `cpanfile.snapshot`, LuaRocks `luarocks.lock`, Dart/Flutter `pubspec.lock`, SwiftPM `Package.resolved`, Carthage `Cartfile.resolved`, CocoaPods `Podfile.lock`, Elixir Mix `mix.lock`, Erlang Rebar3 `rebar.lock`, Ruby Bundler `Gemfile.lock`, PHP Composer `composer.lock`, CycloneDX JSON/XML, SPDX JSON/RDF, SPDX tag-value `.spdx`, and Yarn classic/Berry `yarn.lock` project discovery
- Node-compatible packaged CLI entrypoint for npm, pnpm, Yarn, npx, pnpm dlx, and yarn dlx users
- explicit dependency input selection with `--lockfile <path>` for projects that contain more than one supported input file
- opt-in `--all` discovery that merges every supported input at one project root, deduplicates packages by Package URL, and preserves contributing-lockfile provenance
- direct and transitive dependency graph extraction when the dependency input records parent/child relationships
- Bun, npm, pnpm, and Yarn classic/Berry workspace projects are scanned from every workspace/importer package root
- pnpm `catalog:` and `catalog:<name>` dependency specifiers are resolved from `pnpm-workspace.yaml`
- Deno `deno.lock` projects are scanned for npm package dependencies recorded in `npm:` specifiers; root remote URL imports and JSR packages fail closed instead of being silently skipped
- Rust `Cargo.lock` projects are scanned for crates, using adjacent `Cargo.toml` root dependencies plus literal and segment `*`/`?` Cargo workspace member manifests such as `crates/*`, `crates/app-*`, `tools/?li`, and `crates/*/plugins/*` when available, honoring workspace `exclude` entries, `crate.workspace = true` dependency keys, workspace dependency package aliases, and table-form dependency sections such as `[dependencies.foo]`
- Go `go.work` projects are scanned across workspace modules and apply workspace `replace` directives before module-level replacements; Go `go.mod` projects are scanned for required modules, Go `replace` directives, and adjacent `go.sum` module versions when available
- Python `pylock.toml` and named `pylock.<name>.toml` projects are scanned for versioned PyPI package records and project-root-contained source-tree package records with local source metadata
- Python `pyproject.toml` projects without a companion lockfile are scanned for exact PEP 621 `name==version` direct dependency pins
- Python `uv.lock` projects are scanned for PyPI package dependencies recorded in the lockfile and project-root-contained `directory` or `editable` package source records
- Python PDM `pdm.lock` and `poetry.lock` projects are scanned for PyPI package dependencies recorded in the lockfile
- Python Pipenv `Pipfile.lock` projects are scanned for exact `==version` PyPI package entries and project-root-contained local `path` or editable source entries in the `default` and `develop` sections
- Python PDM `pdm.lock` projects use adjacent `pyproject.toml` root dependencies when available, infer roots from lockfile dependency references otherwise, and scan project-root-contained local `path` or relative `file:` source records
- Python `requirements.txt` files are scanned for pinned direct PyPI package dependencies, project-root-contained local source entries, editable local source entries, nested `-r` requirement files, and exact `-c` constraint pins
- Java Gradle `gradle.lockfile` and legacy `gradle/dependency-locks` directory projects are scanned for Maven coordinates recorded in dependency locking output; explicit `gradle/dependency-locks/*.lockfile` files are also accepted. Java Gradle `gradle/libs.versions.toml` projects are scanned for exact Maven library aliases from compact notation, `module` plus exact `version`, or `module` plus `version.ref`
- Java Maven `pom.xml` projects are scanned for direct dependencies with explicit, property-resolved, same-file `dependencyManagement`, or local `.m2/repository` parent/imported-BOM `dependencyManagement` versions
- Bazel `MODULE.bazel` projects are scanned for direct `bazel_dep` entries with literal exact `version` strings; nodep `repo_name = None` entries, `include()` expansion, overrides, module extensions, and `MODULE.bazel.lock` resolution output fail closed instead of being partial-scanned
- .NET NuGet `packages.lock.json` and restored `obj/project.assets.json` projects are scanned for direct and transitive package dependencies; .NET NuGet `packages.config` and `*.csproj` files are scanned for direct package references, including versions resolved from the nearest `Directory.Packages.props` `PackageVersion` entries
- Conan 2 `conan.lock` projects are scanned for recipe references from `requires`, `build_requires`, and `python_requires`; Conan binary package IDs, settings, options, user/channel, and recipe revisions are not modeled in Package URLs yet
- Conda `environment.yml` and `environment.yaml` projects are scanned for exact Conda `name=version` pins and exact pip `name==version` pins; Conda `conda-lock.yml` and `conda-lock.yaml` projects are scanned for resolved `conda` and `pip` package entries and are preferred when both an environment spec and conda-lock output are present
- vcpkg `vcpkg.json` projects are scanned from installed `vcpkg_installed/vcpkg/status` records when available, or from exact top-level `overrides` when installed status is absent; baseline and `version>=` constraints are not treated as resolved package versions
- Terraform `.terraform.lock.hcl` projects are scanned for locked provider versions; provider constraints and platform hashes are not modeled in Package URLs yet
- Helm `Chart.lock` and `Chart.yaml` projects are scanned for chart dependency entries; `Chart.lock` is preferred when both files are present
- Nix `flake.lock` projects are scanned for reachable flake inputs from the root input graph; Nix derivation package graphs are not reconstructed
- Unity Package Manager `Packages/packages-lock.json` projects are scanned for non-built-in package entries; Unity built-in modules, `Packages/manifest.json` without a lockfile, Asset Store `.unitypackage` archives, Addressables catalogs, and remote UPM registry metadata fetch are not scanned yet
- R `renv.lock` projects are scanned for package records in the lockfile; adjacent root `DESCRIPTION` `Depends`, `Imports`, `LinkingTo`, `Suggests`, and `Enhances` fields are used for production/development root classification when available, while dependency parent graphs, remote CRAN/GitHub/Bioconductor artifact fetch, and Packrat lockfiles are not scanned yet
- Julia `Manifest.toml` projects are scanned for versioned `[[deps.Name]]` records; unversioned standard libraries are skipped, adjacent `Project.toml` `[deps]` and test target `[extras]` entries are used for root/dev classification when available, and remote Julia registry or package server artifact fetch is not scanned yet
- Haskell Stack `stack.yaml.lock` projects are scanned for completed Hackage package pins; local Stack package database license metadata is used when present, while snapshot package expansion, git/path extra-deps, direct/transitive graph reconstruction, and Hackage metadata fetch are not scanned yet
- Perl Carton `cpanfile.snapshot` projects are scanned for Carton snapshot v1 distribution pins and dependency paths inferred from `provides` and `requirements`; local Carton cache archive `META.json` or `META.yml` license metadata is used when present, while MetaCPAN artifact fetch is not scanned yet
- LuaRocks `luarocks.lock` projects are scanned for literal `dependencies` table package pins; local `.rockspec` files in the project root or local rocks tree are used for literal string or string-table license metadata when present, while dependency graph reconstruction and LuaRocks metadata fetch are not scanned yet
- Dart and Flutter `pubspec.lock` projects are scanned for concrete Pub package versions recorded in the lockfile
- Swift Package Manager `Package.resolved` projects are scanned for pinned packages with resolved versions, revisions, or branches; Package.resolved does not expose parent dependency graphs, so packages are reported as root-level pins with unknown dependency type
- Carthage `Cartfile.resolved` projects are scanned for resolved GitHub, git, and binary pins; Cartfile.resolved does not expose parent dependency graphs, so packages are reported as root-level pins with unknown dependency type
- CocoaPods `Podfile.lock` projects are scanned for resolved pods; subspecs are collapsed to their root pod identity and dependency type is reported as unknown because Podfile.lock does not encode production/development groups
- Elixir Mix `mix.lock` projects are scanned for resolved Hex package pins; adjacent root `mix.exs` literal `only:` dependency options are used for production/development root classification when available, while mix.lock dependency graph reconstruction and remote Hex.pm artifact fetch are not scanned yet
- Erlang Rebar3 `rebar.lock` projects are scanned for Hex `pkg` pins; depth-0 Hex pins are classified as production roots, while git/path deps, plugin locks, profile-specific test deps, and Rebar dependency tree reconstruction are not scanned yet
- Ruby Bundler `Gemfile.lock` projects are scanned for direct and transitive gem dependencies
- PHP Composer `composer.lock` projects are scanned for production and development package dependencies, using adjacent `composer.json` root dependencies when available
- CycloneDX JSON/XML, SPDX JSON/RDF, and SPDX tag-value SBOM files are scanned for Package URL-backed package identities, dependency relationships, and embedded license evidence
- explicit `--lockfile` SBOM paths are sniffed by content when their filename does not use a supported SBOM name or suffix
- npm alias dependency resolution, including pnpm alias package keys, with alias context preserved in dependency paths
- production, development, optional, and peer dependency classification
- local `file:` package artifact evidence
- installed `node_modules` package evidence, including npm alias install names, before network fallback
- Yarn Berry `.yarn/cache` package zip evidence before registry fallback for PnP installs without `node_modules`
- local Cargo registry source and `vendor/<crate>` package evidence before unavailable fallback
- local Go module cache, `vendor/<module>`, and project-root-contained local `replace` path evidence before unavailable fallback for `go.work` and `go.mod` scans
- Python `.venv` and `venv` `*.dist-info/METADATA` package evidence, plus project-root-contained local source metadata and license files for `uv.lock`, `pylock.toml`, `requirements.txt`, `Pipfile.lock`, and `pdm.lock` local source entries, before unavailable fallback
- local Maven `.m2/repository` POMs for Maven parent/BOM version management and package license evidence before unavailable fallback for Gradle lockfile and Maven `pom.xml` coordinates
- Bazel module license evidence uses local Bazel registry `local_path` sources from file-based registries when present; remote Bazel registry metadata fetching is not scanned yet
- local NuGet package cache `.nuspec` evidence before unavailable fallback for `packages.lock.json`, `obj/project.assets.json`, `packages.config`, and `*.csproj` packages
- local Conan cache `conanfile.py` metadata and package source license evidence before unavailable fallback for `conan.lock` recipes
- local Conda package cache `info/index.json` metadata and license files before unavailable fallback for `environment.yml`, `environment.yaml`, `conda-lock.yml`, and `conda-lock.yaml` Conda packages
- local vcpkg `vcpkg_installed/<triplet>/share/<port>/copyright` evidence before unavailable fallback for `vcpkg.json` packages
- local Terraform `.terraform/providers` license file evidence before unavailable fallback for `.terraform.lock.hcl` providers
- local Helm `charts/` `Chart.yaml` metadata and license file evidence before unavailable fallback for `Chart.lock` and `Chart.yaml` dependencies
- local Nix path input license file evidence before unavailable fallback for `flake.lock` inputs
- local Unity `Packages/` and `Library/PackageCache` package source evidence before unavailable fallback for `Packages/packages-lock.json` packages
- local R `renv/library` DESCRIPTION metadata and license file evidence before unavailable fallback for `renv.lock` packages
- local Julia depot `Project.toml` metadata and license file evidence before unavailable fallback for `Manifest.toml` packages
- local Stack `.stack-work/install` package database metadata before unavailable fallback for Hackage packages
- local Carton cache archive `META.json` or `META.yml` metadata before unavailable fallback for CPAN distributions
- local Dart Pub cache package source evidence before unavailable fallback for `pubspec.lock` packages
- local SwiftPM `.build/checkouts` and Xcode `SourcePackages/checkouts` package source evidence before unavailable fallback for `Package.resolved` packages
- local Carthage `Carthage/Checkouts` package source evidence before unavailable fallback for `Cartfile.resolved` packages
- local CocoaPods `Pods/<pod>` source and `Pods/Local Podspecs/<pod>.podspec.json` evidence before unavailable fallback for `Podfile.lock` packages
- local Elixir/Erlang `deps/<package>` source and `mix.exs` or `rebar.config` license metadata before unavailable fallback for Hex packages
- local Bundler/RubyGems install path gemspec evidence before unavailable fallback for `Gemfile.lock` gems
- local Composer `vendor/<vendor>/<package>/composer.json` evidence before unavailable fallback for `composer.lock` packages
- remote HTTPS package tarball evidence when the lockfile points to a tarball with supported integrity metadata, with plaintext HTTP, credential-bearing URLs, obvious local, private, special-purpose, and DNS-resolved internal hosts blocked before fetch, connected socket addresses rechecked by the default fetcher, redirects followed only after each target is validated, and transient network failures recorded as unavailable package evidence so other packages can still be scanned
- a shared content-addressed artifact cache with HTTP freshness metadata, conditional `ETag`/`Last-Modified` revalidation, valid stale-entry support in `--offline` mode, and automatic 2 GiB LRU trimming
- `ohrisk cache status|prune|clear` commands for cache inspection, age/size cleanup, and bounded removal
- lockfile integrity verification for local and remote package tarballs; remote tarballs without integrity are reported as unavailable instead of being trusted as license evidence
- npm registry metadata lookup when the lockfile does not include a direct tarball URL
- gzipped package tarball evidence
- `package.json` license fields
- Cargo `Cargo.toml` package `license` fields
- Python `METADATA` `License-Expression`, `License`, and recognized license classifier fields
- Maven POM `<licenses>` names
- NuGet `.nuspec` `<license>` expressions
- Ruby gemspec `license` and `licenses` fields
- Composer package `composer.json` `license` fields
- CycloneDX JSON/XML and SPDX JSON/RDF/tag-value package license declarations from SBOM metadata
- common root-level `LICENSE`, `LICENCE`, `UNLICENSE`, `COPYING`, and `NOTICE` file variants
- medium-confidence standard license detection from recognizable `LICENSE` and `COPYING` file text, including SPDX identifiers, GPL-family v2/v3 text, Zlib text, public-domain-style text, and malformed metadata pointers
- SPDX-like license expression parsing
- common human-readable license metadata alias normalization, including slash and comma dual-license shorthands
- low-risk classification for common permissive, Zlib, and public-domain-style SPDX licenses
- NOTICE evidence is surfaced as attribution-preservation action text without raising severity
- high-risk classification for common source-available restriction licenses
- explicit commercial restriction text detection in license evidence and package metadata
- profile-aware risk evaluation for `saas` and `distributed-app`
- terminal, JSON, and HTML reports
- SARIF 2.1.0 reports for code scanning upload
- waived findings in SARIF output as externally suppressed results
- Markdown reports for PR comments and release notes
- browser-friendly HTML reports for local review
- CycloneDX 1.5 JSON SBOM reports with dependency relationships and Ohrisk risk decision properties
- stable finding IDs for PR comments and local waiver workflows
- local `.ohrisk-waivers.json` waivers by finding ID or fingerprint
- stable diff matching that uses finding fingerprints so severity, recommendation, reason, or evidence changes surface without being triggered by action prose churn
- exact finding fingerprints for SARIF partial fingerprints and audit trails
- finding fingerprints in terminal and Markdown reports for waiver and audit workflows
- structured dependency type and direct/transitive scope in findings
- report file output with project-relative `--output <file>` paths
- optional browser opening for written HTML reports with `--open` through a temporary `127.0.0.1` URL
- command-specific help with `ohrisk help <command>` and `ohrisk <command> --help`
- standalone license expression explanation
- git ref diff reports that show only new or meaningfully changed findings
- `diff --all` comparison of independently discovered current and baseline input sets, including added and removed lockfiles
- strict Draft 2020-12 JSON Schemas for scan, diff, and explain reports, with shared nested definitions and release-time output validation
- JSON threshold outcomes for `ci --fail-on` and `diff --fail-on`
- terminal and Markdown threshold outcomes for `ci --fail-on` and `diff --fail-on`
- strict CI waiver drift checks for expired or unmatched local waivers
- raw scan and CI mode with `--no-waivers` when waiver files should be ignored
- explicit waiver mode in JSON, terminal, Markdown, HTML, and SARIF reports
- explicit waiver mode in CycloneDX SBOM metadata

Central approval workflows, GitHub App checks, Go `go.work` use paths outside the project root, Go local `replace` paths outside the project root, full Go module parent graph
reconstruction, unpinned or direct-reference `pyproject.toml` dependencies, uv, Pipenv, and PDM remote VCS entries, uv, Pipenv, and PDM local source paths outside the project root, remote VCS `requirements.txt` entries, unpinned requirements ranges without exact constraint pins,
remote Maven parent/BOM fetching, Maven transitive graph
resolution, external Maven repository resolution beyond local `.m2/repository`, Gradle graph reconstruction, Gradle version catalog rich versions, bundle aliases, plugin aliases, and usage-site configuration reconstruction, Bazel `MODULE.bazel` `include()` expansion, Bazel overrides, module extensions, `MODULE.bazel.lock` graph reconstruction, remote Bazel registry metadata fetching, Conan 1 graph lock support, Conan binary package ID and remote ConanCenter
artifact fetching, unpinned or ranged Conda `environment.yml` specs, Conda environment transitive dependency reconstruction, explicit per-platform `conda-<platform>.lock` exports, remote Conda channel artifact fetching,
Conda build/channel/subdir Package URL qualifiers, Terraform module scanning, remote Terraform Registry metadata fetching, Helm transitive chart graph
reconstruction, remote Helm repository chart fetching, Nix derivation package graph reconstruction,
Nixpkgs package license extraction, vcpkg baseline-only resolution without installed status,
vcpkg feature/platform selection reconstruction, remote vcpkg registry metadata fetching, SwiftPM parent graph reconstruction,
Carthage parent graph reconstruction, remote Swift package checkout fetching,
Carthage remote checkout or binary framework license fetching, CocoaPods remote podspec or source
fetching, Mix and Rebar3 dependency graph reconstruction, Rebar3 git/path deps, Rebar3 plugin locks, remote Hex.pm artifact fetching,
Composer plugin/platform repository resolution, remote
crates.io, Go proxy, PyPI, Maven, NuGet, pub.dev, RubyGems, or Packagist artifact
fetching are not part of this slice yet.

## Usage

Install with another package manager if you do not want npm:

```bash
pnpm add -g ohrisk
yarn global add ohrisk
bun add -g ohrisk
```

Run once with a package-manager exec command:

```bash
pnpm dlx ohrisk scan
yarn dlx ohrisk scan
bunx ohrisk scan
```

Run a local scan from a supported project:

```bash
ohrisk scan
```

Beginner HTML report flow on Windows PowerShell:

```powershell
npm install -g ohrisk@1.1.3
ohrisk version
cd C:\path\to\your\project
ohrisk scan --html --output reports\ohrisk-report.html --open
ohrisk scan --html --language ko --output reports\ohrisk-report-ko.html --open
ohrisk scan --html --language es --output reports\ohrisk-report-es.html --open
ohrisk scan --html --language fr --output reports\ohrisk-report-fr.html --open
ohrisk scan --html --language zh --output reports\ohrisk-report-zh.html --open
ohrisk scan --html --language hi --output reports\ohrisk-report-hi.html --open
ohrisk scan --html --language ja --output reports\ohrisk-report-ja.html --open
ohrisk scan --html --language id --output reports\ohrisk-report-id.html --open
ohrisk scan --html --language tr --output reports\ohrisk-report-tr.html --open
ohrisk scan --html --language ru --output reports\ohrisk-report-ru.html --open
ohrisk scan --html --language de --output reports\ohrisk-report-de.html --open
```

The scan prints live terminal progress while it reads the project, collects
license evidence, evaluates risk, and writes the report. In CI or redirected
stderr, Ohrisk keeps the plain append-only progress lines so logs stay readable.
When the scan succeeds, the terminal prints `Wrote report to ...` so you can see
the exact saved file path. With `--open`, Ohrisk opens the report through a
temporary `127.0.0.1` browser URL after the HTML file is written. If the browser
does not open, the scan can still succeed; open the printed HTML file path
manually.

If a lockfile contains local `file:` package dependencies that point to sibling
packages outside the current project repository, keep the default fail-closed
boundary and declare the monorepo/workspace root explicitly:

```bash
ohrisk scan --workspace-root .. --html --output reports/ohrisk-report.html
ohrisk ci --workspace-root C:\path\to\workspace --fail-on high
ohrisk diff main --workspace-root .. --prod
```

`--workspace-root` must point to an existing directory. Local package evidence
is then trusted only when the resolved artifact stays inside the project,
repository root, or that explicit workspace root. Local packages marked
`"private": true` in `package.json` are treated as internal package evidence
when they omit public license metadata, so they do not appear as `unknown`
external OSS findings solely because they have no license field.

Print command help or the installed package version:

```bash
ohrisk help
ohrisk help scan
ohrisk version
```

Supported dependency input files:

- dependency-free `package.json` manifests, reported as an empty dependency graph
- `bun.lock`
- `package-lock.json` with either a modern `packages` section or an npm v1 dependency tree
- `npm-shrinkwrap.json` with the same package-lock parser support
- `pnpm-lock.yaml` with `importers`, `packages`, and `snapshots` sections, including default and named catalogs from `pnpm-workspace.yaml`
- `deno.lock` npm package entries from Deno v3/v4-style lockfiles
- `Cargo.lock` crate entries from Rust Cargo projects, using adjacent `Cargo.toml` root dependencies plus literal and segment `*`/`?` Cargo workspace member manifests such as `crates/*`, `crates/app-*`, `tools/?li`, and `crates/*/plugins/*` when available, honoring workspace `exclude` entries, `crate.workspace = true` dependency keys, workspace dependency package aliases, and table-form dependency sections such as `[dependencies.foo]`, plus local Cargo registry source for evidence
- `go.work` workspace modules, workspace `replace` directives, module `go.mod` requirements, module `replace` directives, and adjacent `go.sum` module versions when available, using local Go module cache, `vendor/<module>`, and project-root-contained local replacement path evidence
- `go.mod` module requirements, Go `replace` directives, and adjacent `go.sum` module versions when available, using local Go module cache, `vendor/<module>`, and project-root-contained local replacement path evidence
- `pylock.toml` and `pylock.<name>.toml` versioned package entries and project-root-contained source-tree records from the PyPA lockfile specification, using dependency references for audit paths and installed `.venv`/`venv` dist-info metadata or local source metadata and license files for local evidence
- `pyproject.toml` exact PEP 621 direct dependency pins such as `name==version`, using installed `.venv`/`venv` dist-info metadata for local evidence
- `uv.lock` package entries from Python uv projects plus project-root-contained `directory` and `editable` package source records, using installed `.venv`/`venv` dist-info metadata or local source metadata and license files for local evidence
- `Pipfile.lock` exact `==version` entries and project-root-contained local `path` or editable source entries from Python Pipenv projects, using installed `.venv`/`venv` dist-info metadata or local source metadata and license files for local evidence
- `pdm.lock` package entries and project-root-contained local `path` or relative `file:` source records from Python PDM projects, using adjacent `pyproject.toml` root dependencies when available and installed `.venv`/`venv` dist-info metadata or local source metadata and license files for local evidence
- `poetry.lock` package entries from Python Poetry projects, using adjacent `pyproject.toml` root dependencies when available and installed `.venv`/`venv` dist-info metadata for local evidence
- pinned `requirements.txt` entries such as `name==version`, local source entries such as `-e ./local-package`, `./local-package`, `file:./local-package`, and `name @ file:./local-package`, nested `-r` requirement files, and exact `-c` constraint pins for ranged entries, using installed `.venv`/`venv` dist-info metadata or project-root-contained local source metadata and license files for local evidence
- `gradle.lockfile`, legacy `gradle/dependency-locks` directories, and explicit `gradle/dependency-locks/*.lockfile` Maven coordinates from Java Gradle dependency locking, using local `.m2/repository` POM metadata for evidence
- `gradle/libs.versions.toml` Maven library aliases with exact versions or `version.ref` values from the same catalog, using local `.m2/repository` POM metadata for evidence
- Maven `pom.xml` direct dependencies with explicit versions or versions resolved from local `<properties>`, same-file `dependencyManagement`, or local `.m2/repository` parent/imported-BOM `dependencyManagement`, using local `.m2/repository` POM metadata for evidence
- Bazel `MODULE.bazel` direct `bazel_dep` entries with literal exact versions, failing closed on graph-expanding constructs and using local Bazel registry `local_path` source evidence when present
- .NET NuGet `packages.lock.json` package entries, restored `obj/project.assets.json` package graph entries, `packages.config` package entries, and direct `*.csproj` `PackageReference` entries, resolving central versions from the nearest `Directory.Packages.props` when present and using local NuGet cache `.nuspec` metadata for evidence
- Conan 2 `conan.lock` recipe references from `requires`, `build_requires`, and `python_requires`, using local Conan cache `conanfile.py` metadata and license files for evidence
- Conda `environment.yml` and `environment.yaml` exact package pins plus Conda `conda-lock.yml` and `conda-lock.yaml` package entries, using local Conda package cache `info/index.json` metadata and license files for Conda package evidence
- vcpkg `vcpkg.json` manifest dependencies resolved from installed `vcpkg_installed/vcpkg/status` records or exact top-level overrides, using installed `vcpkg_installed/<triplet>/share/<port>/copyright` files for evidence
- Terraform `.terraform.lock.hcl` provider entries, using local `.terraform/providers` license files for evidence
- Helm `Chart.lock` and `Chart.yaml` chart dependency entries, using local `charts/` `Chart.yaml` metadata and license files for evidence
- Nix `flake.lock` reachable flake input entries, using local path input license files for evidence
- Unity Package Manager `Packages/packages-lock.json` package entries, using local `Packages/` and `Library/PackageCache` source for evidence
- R `renv.lock` package records, using adjacent root `DESCRIPTION` dependency fields for production/development classification and local `renv/library` package source and DESCRIPTION metadata for evidence
- Julia `Manifest.toml` versioned package records, using local Julia depot package source and `Project.toml` metadata for evidence
- Haskell Stack `stack.yaml.lock` completed Hackage package pins, using local Stack package database metadata before unavailable evidence fallback
- Perl Carton `cpanfile.snapshot` distribution pins, using local Carton cache archive metadata before unavailable evidence fallback
- LuaRocks `luarocks.lock` dependency pins, using local `.rockspec` license metadata before unavailable evidence fallback
- Dart/Flutter `pubspec.lock` package entries, using local `.dart_tool/package_config.json` and Pub cache package source for evidence
- SwiftPM `Package.resolved` package pins, using local `.build/checkouts` or `SourcePackages/checkouts` package source for evidence
- Carthage `Cartfile.resolved` package pins, using local `Carthage/Checkouts` package source for evidence
- CocoaPods `Podfile.lock` pod entries, using local `Pods/` source and `Pods/Local Podspecs` metadata for evidence
- Elixir Mix `mix.lock` Hex package pins, using adjacent root `mix.exs` literal `only:` options for production/development classification and local `deps/` package source and `mix.exs` metadata for evidence; Erlang Rebar3 `rebar.lock` Hex package pins, using depth-0 production root classification and local `deps/` package source and `rebar.config` metadata for evidence
- Ruby Bundler `Gemfile.lock` gem entries, using literal companion `Gemfile` group blocks and inline `group:` options for development classification and local Bundler/RubyGems gemspec metadata for evidence
- PHP Composer `composer.lock` package entries, using adjacent `composer.json` root dependencies when available and local `vendor/` package metadata for evidence
- CycloneDX JSON/XML SBOM package entries with Package URL identities, dependency relationships, and embedded license evidence
- SPDX JSON/RDF and tag-value SBOM package entries with Package URL external refs, dependency relationships, and embedded license evidence
- Yarn classic/Berry `yarn.lock` with root and workspace dependency sets from `package.json` manifests, plus local `.yarn/cache` zip evidence for Berry/PnP installs

Select a specific dependency input when a project contains more than one supported input file:

```bash
ohrisk scan --lockfile package-lock.json
ohrisk scan --lockfile npm-shrinkwrap.json
ohrisk ci --lockfile pnpm-lock.yaml --fail-on high
ohrisk scan --lockfile deno.lock
ohrisk scan --lockfile Cargo.lock
ohrisk scan --lockfile go.work
ohrisk scan --lockfile go.mod
ohrisk scan --lockfile pylock.toml
ohrisk scan --lockfile pyproject.toml
ohrisk scan --lockfile uv.lock
ohrisk scan --lockfile Pipfile.lock
ohrisk scan --lockfile pdm.lock
ohrisk scan --lockfile poetry.lock
ohrisk scan --lockfile requirements.txt
ohrisk scan --lockfile gradle.lockfile
ohrisk scan --lockfile gradle/dependency-locks
ohrisk scan --lockfile gradle/dependency-locks/runtimeClasspath.lockfile
ohrisk scan --lockfile gradle/libs.versions.toml
ohrisk scan --lockfile pom.xml
ohrisk scan --lockfile MODULE.bazel
ohrisk scan --lockfile packages.lock.json
ohrisk scan --lockfile obj/project.assets.json
ohrisk scan --lockfile packages.config
ohrisk scan --lockfile MyApp.csproj
ohrisk scan --lockfile conan.lock
ohrisk scan --lockfile environment.yml
ohrisk scan --lockfile conda-lock.yml
ohrisk scan --lockfile vcpkg.json
ohrisk scan --lockfile .terraform.lock.hcl
ohrisk scan --lockfile Chart.lock
ohrisk scan --lockfile Chart.yaml
ohrisk scan --lockfile flake.lock
ohrisk scan --lockfile Packages/packages-lock.json
ohrisk scan --lockfile renv.lock
ohrisk scan --lockfile Manifest.toml
ohrisk scan --lockfile stack.yaml.lock
ohrisk scan --lockfile cpanfile.snapshot
ohrisk scan --lockfile luarocks.lock
ohrisk scan --lockfile pubspec.lock
ohrisk scan --lockfile Package.resolved
ohrisk scan --lockfile Cartfile.resolved
ohrisk scan --lockfile Podfile.lock
ohrisk scan --lockfile mix.lock
ohrisk scan --lockfile rebar.lock
ohrisk scan --lockfile Gemfile.lock
ohrisk scan --lockfile composer.lock
ohrisk scan --lockfile cyclonedx.json
ohrisk scan --lockfile licenses.cdx.json
ohrisk scan --lockfile cyclonedx.xml
ohrisk scan --lockfile sbom.cdx.xml
ohrisk scan --lockfile spdx.json
ohrisk scan --lockfile licenses.spdx.json
ohrisk scan --lockfile spdx.rdf
ohrisk scan --lockfile sbom.spdx.rdf.xml
ohrisk scan --lockfile sbom.spdx
ohrisk diff main --lockfile bun.lock
ohrisk diff main --all
```

Pick the usage profile:

```bash
ohrisk scan --profile saas
ohrisk scan --profile distributed-app
```

Limit the scan to production-relevant dependencies by excluding development-only packages:

```bash
ohrisk scan --prod
```

Print machine-readable output:

```bash
ohrisk scan --json
```

Print SARIF output for code scanning upload:

```bash
ohrisk scan --sarif
```

Print a Markdown report:

```bash
ohrisk scan --markdown --prod
```

Print a CycloneDX SBOM:

```bash
ohrisk scan --cyclonedx --prod
```

Write browser, SARIF, SBOM, or PR reports to files:

```bash
ohrisk scan --html --output reports/ohrisk.html --open
ohrisk scan --html --language ko --output reports/ohrisk-ko.html --open
ohrisk scan --html --language es --output reports/ohrisk-es.html --open
ohrisk scan --html --language fr --output reports/ohrisk-fr.html --open
ohrisk scan --html --language zh --output reports/ohrisk-zh.html --open
ohrisk scan --html --language hi --output reports/ohrisk-hi.html --open
ohrisk scan --html --language ja --output reports/ohrisk-ja.html --open
ohrisk scan --html --language id --output reports/ohrisk-id.html --open
ohrisk scan --html --language tr --output reports/ohrisk-tr.html --open
ohrisk scan --html --language ru --output reports/ohrisk-ru.html --open
ohrisk scan --html --language de --output reports/ohrisk-de.html --open
ohrisk scan --sarif --output reports/ohrisk.sarif
ohrisk scan --cyclonedx --output reports/ohrisk.cdx.json
ohrisk diff main --all --prod --markdown --output reports/ohrisk-pr.md
```

`--output` accepts project-relative file paths only. Absolute paths,
drive-relative paths, UNC paths, and `.` or `..` path segments are rejected.

Fail a local CI step when findings meet a threshold:

```bash
ohrisk ci --fail-on high
```

Fail a local CI step when waiver files contain expired or unmatched waivers:

```bash
ohrisk ci --strict-waivers
```

Run a raw audit scan or CI step without reading local waiver files:

```bash
ohrisk scan --no-waivers
ohrisk ci --no-waivers --fail-on high
```

Waive a finding locally by ID or fingerprint in `.ohrisk-waivers.json`:

```json
{
  "waivers": [
    {
      "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      "reason": "Accepted for this release after internal review.",
      "expiresOn": "2026-09-30"
    }
  ]
}
```

Waived findings are excluded from `ci --fail-on` threshold failures, but scan
and CI JSON, terminal, Markdown, HTML, and SARIF reports still show them. Terminal,
Markdown, and HTML reports include finding fingerprints so waiver files can target
either `id` or `fingerprint`. Expired waivers and unmatched active waivers are
reported separately in JSON, terminal, Markdown, and HTML reports and are not applied.
`ci --strict-waivers` exits non-zero when either expired or unmatched waivers
are present, even if active findings stay below the `--fail-on` threshold. JSON,
terminal, Markdown, HTML, and SARIF outputs include the strict waiver drift result
when that option is enabled. `scan --no-waivers` and `ci --no-waivers` do not
read or apply local waiver files; `ci --no-waivers` cannot be combined with
`--strict-waivers`. Reports include a waiver mode field or summary line so raw
audits can distinguish ignored waiver files from projects with no waivers.
If package names, versions, paths, reasons, or evidence text contain finding
delimiters such as `::`, `>`, or `|`, Ohrisk percent-escapes those characters in
the generated IDs and fingerprints to keep waiver matching unambiguous.

Explain a license expression without scanning a project:

```bash
ohrisk explain AGPL-3.0-only --profile saas
```

Compare the current findings against a baseline git ref:

```bash
ohrisk diff main --prod
ohrisk diff main --prod --fail-on unknown
ohrisk diff main --prod --markdown
```

Baseline refs must be branch, tag, or commit-like names such as `main`,
`origin/main`, `release/v1.2.3`, or a commit hash. Git rev syntax such as
`HEAD@{1}`, `HEAD~1`, and `main:path` is rejected. `diff --all` discovers and
merges the current and baseline input sets independently, then reports added and
removed lockfiles alongside finding changes.

Inspect or clean the shared artifact cache:

```bash
ohrisk cache status
ohrisk cache prune --max-age 7d --max-size 1GiB
ohrisk cache clear
```

The default cache follows the platform cache directory, uses a 24-hour fallback
TTL, conditionally revalidates expired HTTP entries, and automatically trims
least-recently-used content above 2 GiB. Add `--json` for machine-readable cache
command output or `--cache-dir <path>` to target an explicit cache.

Print the package version:

```bash
ohrisk --version
```

## Report Shape

The terminal report is designed to show the highest-risk findings first:

```text
Ohrisk scan
Profile: saas
Production only: yes
Risks: 1 high, 1 review, 1 unknown, 2 low
Waiver mode: local (.ohrisk-waivers.json)
Waived: 0 applied, 0 expired, 0 unmatched

Findings:
- [high] agpl-child@0.1.0
  id: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0
  fingerprint: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only|dependency: production|transitive dependency|source: local|package.json license: AGPL-3.0-only|file: COPYING (copying)
  License expression is high risk for saas.
  recommendation: replace
  action: Replace this package or escalate before shipping.
  dependency: production transitive
  path: fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0
  evidence: license: AGPL-3.0-only; dependency: production; transitive dependency; source: local; package.json license: AGPL-3.0-only; file: COPYING (copying)
```

JSON output reuses the same finding model:

```json
{
  "status": "profile_risk_evaluated",
  "profile": "saas",
  "prodOnly": true,
  "waiverMode": "local",
  "nextAction": "Replace or escalate high-risk dependencies before shipping.",
  "failOn": "high",
  "failed": true,
  "failingFindingCount": 1,
  "findings": [
    {
      "id": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      "fingerprint": "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only|dependency: production|transitive dependency",
      "packageId": "agpl-child@0.1.0",
      "severity": "high",
      "reason": "License expression is high risk for saas.",
      "recommendation": "replace",
      "action": "Replace this package or escalate before shipping.",
      "dependencyType": "production",
      "dependencyScope": "transitive",
      "paths": [
        [
          "fixture-bun-project",
          "permissive-parent@1.0.0",
          "agpl-child@0.1.0"
        ]
      ]
    }
  ]
}
```

Markdown output keeps the scan summary and PR-facing decision fields together:

```markdown
- Licenses: `4 high-confidence`, `0 medium-confidence`, `1 low-confidence`
- License issues: `1 missing`, `0 malformed`
- Waiver mode: `local (.ohrisk-waivers.json)`
- Threshold: failed on high (1 finding at or above threshold)

| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0` | `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas.::license: AGPL-3.0-only\|dependency: production\|transitive dependency\|source: local\|package.json license: AGPL-3.0-only\|file: COPYING (copying)` | high | `agpl-child@0.1.0` | production transitive | License expression is high risk for saas. | replace | Replace this package or escalate before shipping. | fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0 |
```

## Risk Language

Ohrisk intentionally avoids legal `safe` or `unsafe` verdicts.

- `low`: known low-risk license expression for the selected profile
- `review`: review before shipping under the selected profile
- `high`: replace or escalate before shipping under the selected profile, including explicit commercial-use restrictions and packages marked `UNLICENSED`
- `unknown`: missing, malformed, or unrecognized license evidence

For example, GPL is treated differently for `saas` and `distributed-app`
because redistribution changes the risk profile.

## Development

Run the test suite:

```bash
bun test
```

Run the release-ready local gate:

```bash
bun run verify:release
```

Run the fixture scan manually:

```bash
cd test/fixtures/bun-project
bun run ../../../src/cli/main.ts scan --profile saas
```

## Documentation

- [Documentation Index](https://github.com/0disoft/ohrisk/blob/main/docs/README.md) — All guides in one place
- [GitHub Actions Guide](https://github.com/0disoft/ohrisk/blob/main/docs/github-actions.md) — PR gates, comments, SARIF upload, and waiver drift checks
- [Risky Demo](https://github.com/0disoft/ohrisk/blob/main/docs/risky-demo.md) — Run the bundled fixture to see high, review, unknown, and low findings
- [CI Usage Guide](https://github.com/0disoft/ohrisk/blob/main/docs/ci.md) — GitHub Actions examples for PR gates and artifacts
- [Waiver Guide](https://github.com/0disoft/ohrisk/blob/main/docs/waivers.md) — Managing license risk waivers safely
- [Profile Guide](https://github.com/0disoft/ohrisk/blob/main/docs/profiles.md) — Choosing between saas and distributed-app
- [Cache and Registry Configuration](https://github.com/0disoft/ohrisk/blob/main/docs/cache-and-registries.md) — Cache freshness, cleanup, offline mode, and registry authentication
- [Report Formats Guide](https://github.com/0disoft/ohrisk/blob/main/docs/report-formats.md) — What each output format includes
- [Remote Fetching Boundary](https://github.com/0disoft/ohrisk/blob/main/docs/remote-fetching.md) — Remote evidence scope and safety rules
- [한국어 사용 가이드](https://github.com/0disoft/ohrisk/blob/main/docs/ko/README.md) — Korean usage guide for developers
