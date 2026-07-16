import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ACTION_BUNDLE_FINGERPRINT_PREFIX,
  actionBundleSourceFingerprint,
  assertBuiltCliVersion,
  assertVersionContract,
  buildCliBundle
} from "./bundle";

const checkedInBundle = path.join("action-dist", "cli.js");
if (!existsSync(checkedInBundle)) {
  throw new Error("action-dist/cli.js is missing. Run bun run build:action.");
}

const workspace = mkdtempSync(path.join(tmpdir(), "ohrisk-action-bundle-"));
try {
  const freshBundle = await buildCliBundle(workspace);
  const checkedInBytes = readFileSync(checkedInBundle);
  const checkedInSourceFingerprint = readSourceFingerprint(checkedInBytes);
  const expectedSourceFingerprint = actionBundleSourceFingerprint();
  if (checkedInSourceFingerprint !== expectedSourceFingerprint) {
    throw new Error(
      [
        "action-dist/cli.js is stale. Run bun run build:action.",
        `checked-in source sha256: ${checkedInSourceFingerprint ?? "missing"}`,
        `expected source sha256:   ${expectedSourceFingerprint}`
      ].join("\n")
    );
  }

  const packageVersion = assertVersionContract();
  assertBuiltCliVersion(freshBundle, packageVersion);
  assertBuiltCliVersion(checkedInBundle, packageVersion);
  console.log(`Action bundle is current (${sha256(checkedInBytes)}).`);
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

function readSourceFingerprint(bytes: Buffer): string | undefined {
  const header = bytes.toString("utf8", 0, 256);
  const fingerprintPattern = new RegExp(
    `^${escapeRegExp(ACTION_BUNDLE_FINGERPRINT_PREFIX)}([a-f0-9]{64})$`,
    "m"
  );
  return fingerprintPattern.exec(header)?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
