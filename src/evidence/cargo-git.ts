import path from "node:path";

import { readArchiveBytes, type ArchiveSource } from "../archive/archive-reader";
import { parseCargoWorkspacePackageMetadata } from "../graph/rust-cargo-lock";
import type { OhriskError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const CARGO_GIT_MAX_ENTRIES = 50_000;
const CARGO_GIT_ENTRY_MAX_BYTES = 50 * 1024 * 1024;
const CARGO_GIT_EXPANDED_MAX_BYTES = 256 * 1024 * 1024;
const CARGO_GIT_MATERIALIZED_MAX_BYTES = 128 * 1024 * 1024;
const CARGO_GIT_MANIFEST_MAX_BYTES = 1024 * 1024;
const CARGO_GIT_LICENSE_MAX_BYTES = 2 * 1024 * 1024;
const CARGO_GIT_MANIFEST_LIMIT = 256;
const CARGO_GIT_LICENSE_FILE_LIMIT = 50;
const GITHUB_COMPONENT = /^[A-Za-z0-9_.-]+$/u;
const GIT_COMMIT = /^[0-9a-f]{40}$/iu;
const CARGO_GIT_QUERY_KEYS = new Set(["branch", "rev", "tag"]);

export const CARGO_GITHUB_ARCHIVE_HOSTS = new Set(["codeload.github.com"]);

export type CargoGitHubSource = {
  owner: string;
  repository: string;
  commit: string;
  archiveUrl: string;
};

export function parseCargoGitHubSource(resolved: string | undefined): CargoGitHubSource | undefined {
  if (!resolved?.startsWith("git+")) {
    return undefined;
  }

  let source: URL;
  try {
    source = new URL(resolved.slice("git+".length));
  } catch {
    return undefined;
  }
  if (
    source.protocol !== "https:"
    || source.hostname.toLowerCase() !== "github.com"
    || source.port !== ""
    || source.username !== ""
    || source.password !== ""
    || source.pathname.includes("%")
  ) {
    return undefined;
  }

  const segments = source.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return undefined;
  }
  const owner = segments[0];
  const repository = segments[1]?.replace(/\.git$/iu, "");
  const commit = source.hash.slice(1).toLowerCase();
  if (
    !owner
    || !repository
    || !GITHUB_COMPONENT.test(owner)
    || !GITHUB_COMPONENT.test(repository)
    || owner === "."
    || owner === ".."
    || repository === "."
    || repository === ".."
    || !GIT_COMMIT.test(commit)
  ) {
    return undefined;
  }

  const queryKeys = [...source.searchParams.keys()];
  if (
    queryKeys.length > 1
    || queryKeys.some((key) => !CARGO_GIT_QUERY_KEYS.has(key))
    || queryKeys.some((key) => source.searchParams.getAll(key).length !== 1)
    || queryKeys.some((key) => {
      const value = source.searchParams.get(key);
      return value === null || value === "" || value.length > 256 || value.includes("\0");
    })
  ) {
    return undefined;
  }

  return {
    owner,
    repository,
    commit,
    archiveUrl: `https://codeload.github.com/${owner}/${repository}/tar.gz/${commit}`
  };
}

export function collectCargoGitHubArchiveEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  source: CargoGitHubSource;
  archive: Buffer | Uint8Array;
  artifactMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  const symlinks = new Map<string, string>();
  const archive = readArchiveBytes({
    displayName: `${safeDisplayPart(input.source.repository)}-${input.source.commit.slice(0, 12)}.tar.gz`,
    bytes: input.archive,
    formatHint: "tar.gz",
    tarLinkPolicy: "skip",
    onTarSymlink: (entryPath, linkTarget) => {
      symlinks.set(entryPath, linkTarget);
    },
    limits: {
      inputBytes: input.artifactMaxBytes,
      entries: CARGO_GIT_MAX_ENTRIES,
      entryBytes: CARGO_GIT_ENTRY_MAX_BYTES,
      expandedBytes: CARGO_GIT_EXPANDED_MAX_BYTES,
      materializedBytes: CARGO_GIT_MATERIALIZED_MAX_BYTES
    }
  });
  if (!archive.ok) {
    return ok(unavailableEvidence(
      input.packageId,
      `Commit-pinned Cargo Git archive failed bounded inspection (${archive.error.code}); its contents were not trusted.`
    ));
  }

  const root = singleArchiveRoot(archive.value);
  if (!root) {
    return ok(unavailableEvidence(
      input.packageId,
      "Commit-pinned Cargo Git archive did not contain exactly one repository root."
    ));
  }

  const manifestEntries = archive.value.entries
    .filter((entry) =>
      entry.type === "file"
      && entry.path.startsWith(`${root}/`)
      && path.posix.basename(entry.path) === "Cargo.toml"
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  if (manifestEntries.length > CARGO_GIT_MANIFEST_LIMIT) {
    return ok(unavailableEvidence(
      input.packageId,
      "Commit-pinned Cargo Git archive exceeded the Cargo.toml inspection limit."
    ));
  }

  const manifests = new Map<string, string>();
  for (const entry of manifestEntries) {
    const text = archive.value.readText(entry.path, CARGO_GIT_MANIFEST_MAX_BYTES);
    if (text.ok) {
      manifests.set(entry.path, text.value);
    }
  }
  const matches = [...manifests.entries()]
    .map(([manifestPath, manifestText]) => {
      const workspaceManifest = nearestWorkspaceManifest({
        root,
        manifestPath,
        manifests
      });
      return {
        manifestPath,
        manifestText,
        workspaceManifestPath: workspaceManifest?.path,
        metadata: parseCargoWorkspacePackageMetadata({
          manifestText,
          ...(workspaceManifest ? { workspaceManifestText: workspaceManifest.text } : {})
        })
      };
    })
    .filter((candidate) =>
      candidate.metadata.name === input.packageName
      && candidate.metadata.version === input.version
    );
  if (matches.length !== 1) {
    return ok(unavailableEvidence(
      input.packageId,
      matches.length === 0
        ? "Commit-pinned Cargo Git archive did not contain the locked package identity."
        : "Commit-pinned Cargo Git archive contained multiple matching package manifests."
    ));
  }

  const match = matches[0]!;
  const packageDirectory = path.posix.dirname(match.manifestPath);
  const workspaceDirectory = match.workspaceManifestPath
    ? path.posix.dirname(match.workspaceManifestPath)
    : root;
  const evidencePaths = new Map<string, LicenseEvidenceFile["kind"]>();
  addDirectEvidencePaths({
    archive: archive.value,
    directory: packageDirectory,
    root,
    symlinks,
    evidencePaths
  });

  if (match.metadata.licenseFile) {
    const declaredPath = resolveContainedArchivePath({
      root,
      directory: packageDirectory,
      relativePath: match.metadata.licenseFile
    });
    if (declaredPath) {
      evidencePaths.set(declaredPath, "license");
    }
  }
  if (!hasLicenseLikeEvidence(evidencePaths)) {
    addDirectEvidencePaths({
      archive: archive.value,
      directory: workspaceDirectory,
      root,
      symlinks,
      evidencePaths
    });
  }
  if (!hasLicenseLikeEvidence(evidencePaths) && workspaceDirectory !== root) {
    addDirectEvidencePaths({
      archive: archive.value,
      directory: root,
      root,
      symlinks,
      evidencePaths
    });
  }

  const warnings: string[] = [];
  const files: LicenseEvidenceFile[] = [];
  for (const [entryPath, kind] of [...evidencePaths.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, CARGO_GIT_LICENSE_FILE_LIMIT)) {
    const entry = archive.value.entries.find((candidate) =>
      candidate.type === "file" && candidate.path === entryPath
    );
    if (!entry) {
      warnings.push(`Cargo.toml declared missing license-file ${archiveRelativePath(root, entryPath)}.`);
      continue;
    }
    const text = archive.value.readText(entryPath, CARGO_GIT_LICENSE_MAX_BYTES);
    if (!text.ok) {
      warnings.push(`Skipped ${archiveRelativePath(root, entryPath)}: Cargo license evidence exceeded bounded text limits.`);
      continue;
    }
    files.push({
      path: archiveRelativePath(root, entryPath),
      kind,
      text: text.value
    });
  }

  if (files.length === 0) {
    warnings.push("Commit-pinned Cargo Git source did not contain a package or workspace license evidence file.");
  }
  if (!match.metadata.license) {
    warnings.push("Cargo.toml did not declare a package license.");
  }

  return ok({
    packageId: input.packageId,
    ...(match.metadata.license
      ? {
          metadataLicense: match.metadata.license,
          metadataSource: "Cargo.toml at pinned Git commit"
        }
      : {}),
    files,
    source: "tarball",
    warnings
  });
}

function singleArchiveRoot(archive: ArchiveSource): string | undefined {
  const roots = new Set(
    archive.entries
      .map((entry) => entry.path.split("/")[0])
      .filter((value): value is string => value !== undefined && value !== "")
  );
  return roots.size === 1 ? [...roots][0] : undefined;
}

function nearestWorkspaceManifest(input: {
  root: string;
  manifestPath: string;
  manifests: ReadonlyMap<string, string>;
}): { path: string; text: string } | undefined {
  let directory = path.posix.dirname(input.manifestPath);
  while (directory === input.root || directory.startsWith(`${input.root}/`)) {
    const candidatePath = `${directory}/Cargo.toml`;
    const candidateText = input.manifests.get(candidatePath);
    if (candidateText && /^\s*\[workspace(?:\.package)?\]/mu.test(candidateText)) {
      return { path: candidatePath, text: candidateText };
    }
    if (directory === input.root) {
      break;
    }
    directory = path.posix.dirname(directory);
  }
  return undefined;
}

function addDirectEvidencePaths(input: {
  archive: ArchiveSource;
  directory: string;
  root: string;
  symlinks: ReadonlyMap<string, string>;
  evidencePaths: Map<string, LicenseEvidenceFile["kind"]>;
}): void {
  const prefix = `${input.directory}/`;
  for (const entry of input.archive.entries) {
    if (entry.type !== "file" || !entry.path.startsWith(prefix)) {
      continue;
    }
    const fileName = entry.path.slice(prefix.length);
    if (fileName === "" || fileName.includes("/")) {
      continue;
    }
    const kind = classifyEvidenceFile(fileName);
    if (kind && !input.evidencePaths.has(entry.path)) {
      input.evidencePaths.set(entry.path, kind);
    }
  }
  for (const [linkPath, linkTarget] of input.symlinks) {
    if (!linkPath.startsWith(prefix)) {
      continue;
    }
    const fileName = linkPath.slice(prefix.length);
    if (fileName === "" || fileName.includes("/")) {
      continue;
    }
    const kind = classifyEvidenceFile(fileName);
    const resolved = kind
      ? resolveContainedArchivePath({
          root: input.root,
          directory: input.directory,
          relativePath: linkTarget
        })
      : undefined;
    if (
      kind
      && resolved
      && input.archive.entries.some((entry) => entry.type === "file" && entry.path === resolved)
      && !input.evidencePaths.has(resolved)
    ) {
      input.evidencePaths.set(resolved, kind);
    }
  }
}

function hasLicenseLikeEvidence(
  evidencePaths: ReadonlyMap<string, LicenseEvidenceFile["kind"]>
): boolean {
  return [...evidencePaths.values()].some((kind) => kind === "license" || kind === "copying");
}

function resolveContainedArchivePath(input: {
  root: string;
  directory: string;
  relativePath: string;
}): string | undefined {
  if (
    input.relativePath.includes("\0")
    || path.posix.isAbsolute(input.relativePath)
    || path.win32.isAbsolute(input.relativePath)
  ) {
    return undefined;
  }
  const resolved = path.posix.normalize(path.posix.join(input.directory, input.relativePath.replace(/\\/g, "/")));
  return resolved === input.root || resolved.startsWith(`${input.root}/`)
    ? resolved
    : undefined;
}

function archiveRelativePath(root: string, entryPath: string): string {
  return entryPath.startsWith(`${root}/`) ? entryPath.slice(root.length + 1) : entryPath;
}

function unavailableEvidence(packageId: string, warning: string): LicenseEvidence {
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [warning]
  };
}

function safeDisplayPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._+-]/g, "_").slice(0, 120) || "repository";
}
