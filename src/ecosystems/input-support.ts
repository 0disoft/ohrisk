import type { SupportedLockfileKind } from "../project/input";
import type { InputSupport } from "../../types/report-types";
export type { InputSupport } from "../../types/report-types";

// Capabilities do not assert that a particular scan exercised or completed them.
type Declaration = readonly [InputSupport["relationships"], InputSupport["developmentScope"], InputSupport["artifactPins"]];
const declarations = {
  bun: ["bounded-paths", "declared", "checksums"],
  "package-lock": ["source-edges", "declared", "checksums"],
  "npm-shrinkwrap": ["source-edges", "declared", "checksums"],
  "pnpm-lock": ["source-edges", "declared", "checksums"],
  "deno-lock": ["bounded-paths", "declared", "checksums"],
  "yarn-lock": ["bounded-paths", "companion-dependent", "checksums"],
  "package-json": ["direct-only", "declared", "none"],
  "cargo-lock": ["bounded-paths", "companion-dependent", "checksums-or-revisions"],
  "go-work": ["bounded-paths", "heuristic", "checksums"],
  "go-mod": ["bounded-paths", "heuristic", "checksums"],
  "pipfile-lock": ["inventory", "declared", "none"],
  "pdm-lock": ["bounded-paths", "declared", "none"],
  "poetry-lock": ["bounded-paths", "declared", "none"],
  "pyproject-toml": ["direct-only", "declared", "none"],
  "requirements-txt": ["direct-only", "unavailable", "none"],
  "uv-lock": ["source-edges", "declared", "none"],
  pylock: ["bounded-paths", "unavailable", "none"],
  "gradle-lock": ["inventory", "declared", "none"],
  "gradle-version-catalog": ["direct-only", "unavailable", "none"],
  "maven-pom": ["bounded-paths", "declared", "none"],
  "bazel-module": ["direct-only", "declared", "none"],
  "nuget-lock": ["bounded-paths", "companion-dependent", "checksums"],
  "nuget-assets": ["bounded-paths", "companion-dependent", "checksums"],
  "dotnet-project": ["direct-only", "declared", "none"],
  "nuget-packages-config": ["inventory", "unavailable", "none"],
  "conan-lock": ["inventory", "declared", "none"],
  "conda-environment": ["direct-only", "unavailable", "none"],
  "conda-lock": ["bounded-paths", "declared", "none"],
  "vcpkg-json": ["bounded-paths", "declared", "none"],
  "terraform-lock": ["inventory", "unavailable", "none"],
  "helm-chart-lock": ["direct-only", "unavailable", "checksums"],
  "helm-chart-yaml": ["direct-only", "unavailable", "none"],
  "nix-flake-lock": ["source-edges", "unavailable", "checksums-or-revisions"],
  "unity-packages-lock": ["bounded-paths", "unavailable", "none"],
  "renv-lock": ["inventory", "declared", "none"],
  "julia-manifest": ["bounded-paths", "declared", "none"],
  "stack-lock": ["inventory", "unavailable", "checksums"],
  "cpanfile-snapshot": ["bounded-paths", "unavailable", "none"],
  "luarocks-lock": ["inventory", "unavailable", "none"],
  "pubspec-lock": ["inventory", "declared", "checksums"],
  "swift-package-resolved": ["inventory", "unavailable", "none"],
  "cartfile-resolved": ["inventory", "unavailable", "none"],
  "podfile-lock": ["bounded-paths", "unavailable", "none"],
  "mix-lock": ["inventory", "declared", "checksums"],
  "rebar-lock": ["inventory", "unavailable", "none"],
  "gemfile-lock": ["bounded-paths", "companion-dependent", "none"],
  "composer-lock": ["bounded-paths", "declared", "none"],
  "cyclonedx-json": ["source-edges", "declared", "none"],
  "cyclonedx-xml": ["source-edges", "declared", "none"],
  "spdx-json": ["source-edges", "unavailable", "none"],
  "spdx-rdf": ["source-edges", "unavailable", "none"],
  "spdx-tag-value": ["source-edges", "unavailable", "none"],
  "zig-zon": ["direct-only", "unavailable", "checksums"]
} as const satisfies Record<SupportedLockfileKind, Declaration>;

export function builtInInputSupport(kind: SupportedLockfileKind): InputSupport {
  const [relationships, developmentScope, artifactPins] = declarations[kind];
  return { relationships, developmentScope, artifactPins };
}

export function validInputSupport(value: unknown): value is InputSupport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3
    && Object.keys(record).every((key) => ["relationships", "developmentScope", "artifactPins"].includes(key))
    && typeof record.relationships === "string"
    && ["source-edges", "bounded-paths", "direct-only", "inventory"].includes(record.relationships)
    && typeof record.developmentScope === "string"
    && ["declared", "companion-dependent", "heuristic", "unavailable"].includes(record.developmentScope)
    && typeof record.artifactPins === "string"
    && ["checksums", "checksums-or-revisions", "revisions", "none"].includes(record.artifactPins);
}
