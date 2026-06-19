export type OhriskErrorCategory =
  | "invalid_input"
  | "unsupported_input"
  | "filesystem"
  | "network"
  | "internal";

export type OhriskErrorCode =
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED_COMMAND"
  | "NO_SUPPORTED_LOCKFILE"
  | "MULTIPLE_LOCKFILES"
  | "LOCKFILE_NOT_FOUND"
  | "LOCKFILE_NOT_FILE"
  | "UNSUPPORTED_LOCKFILE"
  | "PROJECT_DISCOVERY_FAILED"
  | "BUN_LOCK_READ_FAILED"
  | "BUN_LOCK_PARSE_FAILED"
  | "PACKAGE_LOCK_READ_FAILED"
  | "PACKAGE_LOCK_PARSE_FAILED"
  | "PNPM_LOCK_READ_FAILED"
  | "PNPM_LOCK_PARSE_FAILED"
  | "YARN_LOCK_READ_FAILED"
  | "YARN_LOCK_PARSE_FAILED"
  | "YARN_PACKAGE_JSON_READ_FAILED"
  | "YARN_PACKAGE_JSON_PARSE_FAILED"
  | "YARN_WORKSPACE_PACKAGE_JSON_READ_FAILED"
  | "GIT_REF_FILE_NOT_FOUND"
  | "GIT_REF_READ_FAILED"
  | "GIT_REF_PATH_OUTSIDE_PROJECT"
  | "REPORT_WRITE_FAILED"
  | "PACKAGE_EVIDENCE_READ_FAILED"
  | "PACKAGE_JSON_PARSE_FAILED"
  | "PACKAGE_INTEGRITY_CHECK_FAILED"
  | "WAIVER_FILE_READ_FAILED"
  | "WAIVER_FILE_PARSE_FAILED"
  | "TARBALL_PARSE_FAILED"
  | "REGISTRY_METADATA_FETCH_FAILED"
  | "TARBALL_FETCH_FAILED";

export type OhriskError = {
  code: OhriskErrorCode;
  category: OhriskErrorCategory;
  message: string;
  details?: Record<string, unknown>;
};

export function createError(error: OhriskError): OhriskError {
  return error;
}

export function exitCodeForError(error: OhriskError): number {
  switch (error.category) {
    case "invalid_input":
    case "unsupported_input":
      return 2;
    case "filesystem":
    case "network":
    case "internal":
      return 1;
  }
}

export function formatError(error: OhriskError): string {
  const lines = [
    "Ohrisk could not complete the command.",
    `${error.code}: ${error.message}`
  ];

  if (error.details) {
    for (const [key, value] of Object.entries(error.details)) {
      lines.push(`${key}: ${formatDetail(value)}`);
    }
  }

  return lines.join("\n");
}

function formatDetail(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "none" : value.join(", ");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "none";
  }

  return JSON.stringify(value);
}
