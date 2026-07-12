import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
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
  const freshBytes = readFileSync(freshBundle);
  if (!checkedInBytes.equals(freshBytes)) {
    throw new Error(
      [
        "action-dist/cli.js is stale. Run bun run build:action.",
        `checked-in sha256: ${sha256(checkedInBytes)}`,
        `expected sha256:   ${sha256(freshBytes)}`
      ].join("\n")
    );
  }

  assertBuiltCliVersion(checkedInBundle, assertVersionContract());
  console.log(`Action bundle is current (${sha256(checkedInBytes)}).`);
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
