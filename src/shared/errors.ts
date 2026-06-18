export type OhriskErrorCategory =
  | "invalid_input"
  | "unsupported_input"
  | "filesystem"
  | "internal";

export type OhriskErrorCode =
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED_COMMAND"
  | "NO_SUPPORTED_LOCKFILE"
  | "MULTIPLE_LOCKFILES"
  | "PROJECT_DISCOVERY_FAILED";

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
