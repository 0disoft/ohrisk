import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type OpenedReport = {
  target: string;
};

export type ReportOpener = (
  input: { reportPath: string }
) => Result<OpenedReport, OhriskError> | Promise<Result<OpenedReport, OhriskError>>;

type OpenCommandRunner = (
  command: string,
  args: string[]
) => { error?: Error; status: number | null };

type ReportOpenerOptions = {
  closeDelayMs?: number;
  openCommandRunner?: OpenCommandRunner;
  serverTimeoutMs?: number;
};

const LOOPBACK_HOST = "127.0.0.1";
const REPORT_SERVER_TIMEOUT_MS = 10_000;
const REPORT_SERVER_CLOSE_DELAY_MS = 500;
const OPEN_COMMAND_TIMEOUT_MS = 3_000;
const REPORT_TOKEN_BYTES = 16;
const TEXT_RESPONSE_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

export function createReportOpener(options: ReportOpenerOptions = {}): ReportOpener {
  const openCommandRunner = options.openCommandRunner ?? defaultOpenCommandRunner;
  const serverTimeoutMs = options.serverTimeoutMs ?? REPORT_SERVER_TIMEOUT_MS;
  const closeDelayMs = options.closeDelayMs ?? REPORT_SERVER_CLOSE_DELAY_MS;

  return async (input) => {
    let report: Buffer;
    try {
      report = readFileSync(input.reportPath);
    } catch (cause) {
      return err(
        createReportOpenError({
          reportPath: input.reportPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        })
      );
    }

    return openReportBuffer({
      reportPath: input.reportPath,
      report,
      openCommandRunner,
      serverTimeoutMs,
      closeDelayMs
    });
  };
}

export const openReportFile: ReportOpener = createReportOpener();

function openReportBuffer(input: {
  reportPath: string;
  report: Buffer;
  openCommandRunner: OpenCommandRunner;
  serverTimeoutMs: number;
  closeDelayMs: number;
}): Promise<Result<OpenedReport, OhriskError>> {
  return new Promise((resolve) => {
    let finished = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let closeDelay: ReturnType<typeof setTimeout> | undefined;
    const token = createReportToken();

    const server = createServer((request, response) => {
      const expectedHost = localReportHost(server);
      const requestUrl = new URL(request.url ?? "/", `http://${expectedHost}`);

      if (request.headers.host !== expectedHost || requestUrl.host !== expectedHost) {
        response.writeHead(403, TEXT_RESPONSE_HEADERS);
        response.end("Forbidden");
        return;
      }

      if (requestUrl.searchParams.get("token") !== token) {
        response.writeHead(403, TEXT_RESPONSE_HEADERS);
        response.end("Forbidden");
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          allow: "GET, HEAD",
          ...TEXT_RESPONSE_HEADERS
        });
        response.end("Method Not Allowed");
        return;
      }

      if (requestUrl.pathname !== "/" && requestUrl.pathname !== "/report.html") {
        response.writeHead(404, TEXT_RESPONSE_HEADERS);
        response.end("Not Found");
        return;
      }

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": input.report.byteLength,
        "content-security-policy": [
          "default-src 'none'",
          "base-uri 'none'",
          "connect-src 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'",
          "img-src 'self' data:",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'"
        ].join("; "),
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff"
      });
      response.end(request.method === "HEAD" ? undefined : input.report);
      if (request.method === "HEAD") {
        return;
      }

      closeDelay = setTimeout(() => {
        finish(ok({ target: localReportUrl(server, token) }));
      }, input.closeDelayMs);
    });

    const finish = (result: Result<OpenedReport, OhriskError>) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (closeDelay) {
        clearTimeout(closeDelay);
      }
      server.close(() => resolve(result));
    };

    server.once("error", (cause) => {
      finish(err(
        createReportOpenError({
          reportPath: input.reportPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        })
      ));
    });

    server.listen(0, LOOPBACK_HOST, () => {
      const target = localReportUrl(server, token);
      const command = openCommandFor(process.platform, target);
      const result = input.openCommandRunner(command.command, command.args);

      if (result.error || result.status !== 0) {
        finish(err(
          createReportOpenError({
            reportPath: input.reportPath,
            opener: command.command,
            cause: result.error?.message ?? `opener exited with status ${result.status ?? "unknown"}`
          })
        ));
        return;
      }

      timeout = setTimeout(() => {
        finish(err(
          createReportOpenError({
            reportPath: input.reportPath,
            opener: command.command,
            cause: "timed out waiting for the browser to request the local report"
          })
        ));
      }, input.serverTimeoutMs);
    });
  });
}

function createReportOpenError(input: {
  reportPath: string;
  cause: string;
  opener?: string;
}): OhriskError {
  return createError({
    code: "REPORT_OPEN_FAILED",
    category: "filesystem",
    message: "Failed to open the requested report file.",
    details: {
      reportPath: input.reportPath,
      ...(input.opener ? { opener: input.opener } : {}),
      cause: input.cause
    }
  });
}

function defaultOpenCommandRunner(
  command: string,
  args: string[]
): { error?: Error; status: number | null } {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    timeout: OPEN_COMMAND_TIMEOUT_MS,
    windowsHide: true
  });

  return {
    ...(result.error ? { error: result.error } : {}),
    status: result.status
  };
}

function createReportToken(): string {
  return randomBytes(REPORT_TOKEN_BYTES).toString("hex");
}

function localReportHost(server: { address: () => string | AddressInfo | null }): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    return LOOPBACK_HOST;
  }

  return `${LOOPBACK_HOST}:${address.port}`;
}

function localReportUrl(
  server: { address: () => string | AddressInfo | null },
  token: string
): string {
  return `http://${localReportHost(server)}/report.html?token=${token}`;
}

function openCommandFor(
  platform: NodeJS.Platform,
  target: string
): { command: string; args: string[] } {
  switch (platform) {
    case "win32":
      return { command: "explorer.exe", args: [target] };
    case "darwin":
      return { command: "open", args: [target] };
    default:
      return { command: "xdg-open", args: [target] };
  }
}
