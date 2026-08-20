export interface NpmPackResult {
  filename?: unknown;
}

export function readNpmPackResult(
  stdout: string,
  packageName: string
): NpmPackResult | undefined {
  const parsed = JSON.parse(stdout) as unknown;

  if (Array.isArray(parsed)) {
    return parsed.length === 1 && isJsonObject(parsed[0]) ? parsed[0] : undefined;
  }

  if (!isJsonObject(parsed)) {
    return undefined;
  }

  if (Object.hasOwn(parsed, "filename")) {
    return parsed;
  }

  const packageResult = parsed[packageName];
  return isJsonObject(packageResult) ? packageResult : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
