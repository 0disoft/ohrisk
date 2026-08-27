import type { OhriskError } from "../shared/errors";
import type { Result } from "../shared/result";

export type ArchiveFormat = "zip" | "tar" | "tar.gz";

export type ArchiveLimits = {
  inputBytes: number;
  entries: number;
  pathBytes: number;
  pathSegments: number;
  segmentBytes: number;
  entryBytes: number;
  expandedBytes: number;
  materializedBytes: number;
  compressionRatio: number;
  compressionRatioMinBytes: number;
  workDeadlineMs: number;
};

export type ArchiveEntry = Readonly<{
  path: string;
  type: "file" | "directory";
  size: number;
  compressedSize: number;
}>;

export type ArchiveWorkBudget = Readonly<{
  checkpoint: (entryPath?: string) => Result<void, OhriskError>;
}>;

export type ArchiveSource = Readonly<{
  format: ArchiveFormat;
  displayPath: string;
  sha256: string;
  entries: readonly ArchiveEntry[];
  listPaths: () => readonly string[];
  beginWork: () => ArchiveWorkBudget;
  readEntry: (entryPath: string) => Result<Buffer, OhriskError>;
  hashEntrySha256: (entryPath: string) => Result<string, OhriskError>;
  readText: (entryPath: string, maxBytes?: number) => Result<string, OhriskError>;
}>;

export type ReadArchiveFileInput = {
  cwd: string;
  archivePath: string;
  limits?: Partial<ArchiveLimits>;
  now?: () => number;
  signal?: AbortSignal;
};

export type ReadArchiveBytesInput = {
  displayName: string;
  bytes: Buffer | Uint8Array;
  formatHint?: ArchiveFormat;
  limits?: Partial<ArchiveLimits>;
  now?: () => number;
  signal?: AbortSignal;
  /** Trusted source archives may contain Git links that callers never materialize. */
  tarLinkPolicy?: "reject" | "skip";
  /** Receives validated TAR symlink paths without following or materializing them. */
  onTarSymlink?: (entryPath: string, linkTarget: string) => void;
};
