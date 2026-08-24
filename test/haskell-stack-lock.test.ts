import path from "node:path";
import { describe, expect, test } from "bun:test";

import { parseStackLockText } from "../src/graph/haskell-stack-lock";

describe("parseStackLockText", () => {
  test("parses Stack Hackage package pins", () => {
    const riskChecksum = "a".repeat(64);
    const base64Checksum = "b".repeat(64);
    const result = parseStackLockText([
      "packages:",
      "- completed:",
      `    hackage: risk-haskell-1.2.3@sha256:${riskChecksum},1234`,
      "    pantry-tree:",
      "      sha256: tree",
      "      size: 42",
      "  original:",
      "    hackage: risk-haskell-1.2.3",
      "- completed:",
      `    hackage: base64-bytestring-1.2.1.0@sha256:${base64Checksum},5678`,
      "  original:",
      "    hackage: base64-bytestring-1.2.1.0",
      "- completed:",
      "    git: https://example.invalid/acme/private.git",
      "    commit: abc123",
      "  original:",
      "    git: https://example.invalid/acme/private.git",
      "snapshots:",
      "- completed:",
      "    url: https://raw.githubusercontent.com/commercialhaskell/stackage-snapshots/master/lts/22/0.yaml",
      "  original: lts-22.0"
    ].join("\n"), path.join("fixture-haskell", "stack.yaml.lock"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-haskell");
    expect(result.value.nodes).toEqual([
      {
        id: "base64-bytestring@1.2.1.0",
        name: "base64-bytestring",
        version: "1.2.1.0",
        ecosystem: "hackage",
        resolved: "https://hackage.haskell.org/package/base64-bytestring-1.2.1.0/base64-bytestring.cabal",
        integrity: `sha256-${Buffer.from(base64Checksum, "hex").toString("base64")}`,
        dependencyType: "unknown",
        direct: true,
        paths: [["fixture-haskell", "base64-bytestring@1.2.1.0"]]
      },
      {
        id: "risk-haskell@1.2.3",
        name: "risk-haskell",
        version: "1.2.3",
        ecosystem: "hackage",
        resolved: "https://hackage.haskell.org/package/risk-haskell-1.2.3/risk-haskell.cabal",
        integrity: `sha256-${Buffer.from(riskChecksum, "hex").toString("base64")}`,
        dependencyType: "unknown",
        direct: true,
        paths: [["fixture-haskell", "risk-haskell@1.2.3"]]
      }
    ]);
  });

  test("rejects malformed completed Hackage checksums", () => {
    const result = parseStackLockText([
      "packages:",
      "- completed:",
      "    hackage: risk-haskell-1.2.3@sha256:not-a-digest,1234",
      "  original:",
      "    hackage: risk-haskell-1.2.3"
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed Hackage checksum to fail.");
    }

    expect(result.error.code).toBe("STACK_LOCK_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      lockfilePath: "stack.yaml.lock",
      reason: "invalid_hackage_package",
      index: 0
    });
  });

  test("reports lockfiles without Hackage pins as typed errors", () => {
    const result = parseStackLockText([
      "packages:",
      "- completed:",
      "    git: https://example.invalid/acme/private.git",
      "  original:",
      "    git: https://example.invalid/acme/private.git",
      "- completed:",
      "    path: ../local-package",
      "  original:",
      "    path: ../local-package"
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected stack.yaml.lock parse failure.");
    }

    expect(result.error.code).toBe("STACK_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "stack.yaml.lock",
      reason: "unsupported_stack_dependency_entries",
      unsupportedDependencyTypes: ["git", "path"],
      unsupportedDependencyIndexes: [0, 1]
    });
  });
});
