export function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export function redactUrlCredentialsInDetails(
  details: Record<string, unknown>
): Record<string, unknown> {
  const redacted = { ...details };
  for (const key of [
    "registryUrl",
    "resolved",
    "tarballUrl",
    "artifactPath",
    "redirectFrom",
    "redirectUrl",
    "redirectLocation"
  ]) {
    const value = redacted[key];
    if (typeof value === "string") {
      redacted[key] = safeUrlForErrorDetails(value);
    }
  }

  return redacted;
}

export function safeOptionalUrlForErrorDetails(
  value: string | undefined
): string | undefined {
  return value === undefined ? undefined : safeUrlForErrorDetails(value);
}

export function safeErrorCauseForDetails(cause: unknown): string {
  return safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause));
}

export function safeUrlForErrorDetails(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
    ) {
      return redactUrlCredentialsInText(value);
    }

    if (url.username !== "") {
      url.username = "redacted";
    }
    if (url.password !== "") {
      url.password = "redacted";
    }

    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return redactUrlCredentialsInText(value);
  }
}

function redactUrlCredentialsInText(value: string): string {
  return value
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    )
    .replace(
      /([a-z][a-z0-9+.-]*:\/)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    )
    .replace(
      /([a-z][a-z0-9+.-]{1,}:\\+)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    );
}
