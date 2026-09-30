# Input Support Contract

This table describes the current parser and collector boundary. It does not certify a particular scan as complete or an artifact as verified.

- `source-edges`: source relationships are retained independently of bounded display paths. Missing relationships and unresolved requests still affect the scan's graph dimension.
- `bounded-paths`: relationships are reconstructed through explanatory paths, potentially using companion files or collected module metadata. Display limits can prevent exhaustive relationship reconstruction.
- `direct-only`: the manifest contributes dependency declarations without a resolved transitive graph.
- `inventory`: package records are available, but package-to-package relationships are not reconstructed.
- Development scope is `declared`, `companion-dependent`, `heuristic`, or `unavailable`. Declared scope depends on the supported fields actually being present; unavailable scope is not production proof.
- Artifact pins describe retained checksum or revision coordinates, including supported companion inputs. A pin may be absent. `none` means this parser does not retain such pins, even if the upstream format can contain them.
- Network, host, DNS, connected-address, archive limits, and actual content verification remain owned by the shared evidence collectors. Adapter declarations grant no network authority.

Use report completeness dimensions and evidence diagnostics to determine what the individual scan actually inspected. The overall collection status can be complete while the graph dimension is unknown.

Scan JSON `lockfiles[].support` and diff JSON `lockfileChanges` entries expose this contract. SARIF uses `ohriskInputSupport`; CycloneDX uses `ohrisk:inputSupport`. These fields describe capability, not per-artifact verification.

| Input kind | Adapter | Relationships | Development scope | Artifact pins |
|---|---|---|---|---|
| bazel-module | bazel | direct-only | declared | none |
| bun | javascript | bounded-paths | declared | checksums |
| cargo-lock | rust | bounded-paths | companion-dependent | checksums-or-revisions |
| cartfile-resolved | carthage | inventory | unavailable | none |
| composer-lock | php | bounded-paths | declared | none |
| conan-lock | cpp | inventory | declared | none |
| conda-environment | conda | direct-only | unavailable | none |
| conda-lock | conda | bounded-paths | declared | none |
| cpanfile-snapshot | perl | bounded-paths | unavailable | none |
| cyclonedx-json | sbom | source-edges | declared | none |
| cyclonedx-xml | sbom | source-edges | declared | none |
| deno-lock | javascript | bounded-paths | declared | checksums |
| dotnet-project | dotnet | direct-only | declared | none |
| gemfile-lock | ruby | bounded-paths | companion-dependent | none |
| go-mod | go | bounded-paths | heuristic | checksums |
| go-work | go | bounded-paths | heuristic | checksums |
| gradle-lock | jvm | inventory | declared | none |
| gradle-version-catalog | jvm | direct-only | unavailable | none |
| helm-chart-lock | helm | direct-only | unavailable | checksums |
| helm-chart-yaml | helm | direct-only | unavailable | none |
| julia-manifest | julia | bounded-paths | declared | none |
| luarocks-lock | lua | inventory | unavailable | none |
| maven-pom | jvm | bounded-paths | declared | none |
| mix-lock | elixir | inventory | declared | checksums |
| nix-flake-lock | nix | source-edges | unavailable | checksums-or-revisions |
| npm-shrinkwrap | javascript | source-edges | declared | checksums |
| nuget-assets | dotnet | bounded-paths | companion-dependent | checksums |
| nuget-lock | dotnet | bounded-paths | companion-dependent | checksums |
| nuget-packages-config | dotnet | inventory | unavailable | none |
| package-json | javascript | direct-only | declared | none |
| package-lock | javascript | source-edges | declared | checksums |
| pdm-lock | python | bounded-paths | declared | none |
| pipfile-lock | python | inventory | declared | none |
| pnpm-lock | javascript | source-edges | declared | checksums |
| podfile-lock | cocoapods | bounded-paths | unavailable | none |
| poetry-lock | python | bounded-paths | declared | none |
| pubspec-lock | dart | inventory | declared | checksums |
| pylock | python | bounded-paths | unavailable | none |
| pyproject-toml | python | direct-only | declared | none |
| rebar-lock | elixir | inventory | unavailable | none |
| renv-lock | r | inventory | declared | none |
| requirements-txt | python | direct-only | unavailable | none |
| spdx-json | sbom | source-edges | unavailable | none |
| spdx-rdf | sbom | source-edges | unavailable | none |
| spdx-tag-value | sbom | source-edges | unavailable | none |
| stack-lock | haskell | inventory | unavailable | checksums |
| swift-package-resolved | swift | inventory | unavailable | none |
| terraform-lock | terraform | inventory | unavailable | none |
| unity-packages-lock | unity | bounded-paths | unavailable | none |
| uv-lock | python | source-edges | declared | none |
| vcpkg-json | cpp | bounded-paths | declared | none |
| yarn-lock | javascript | bounded-paths | companion-dependent | checksums |
| zig-zon | zig | direct-only | unavailable | checksums |

This document is generated from adapter declarations by the configured `ohrisk_generate_input_support_docs` intent. The related verification intent checks synchronization.
