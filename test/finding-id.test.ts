import { describe, expect, test } from "bun:test";

import { buildFindingFingerprint, buildFindingId } from "../src/policy/finding-id";

describe("finding identity", () => {
  test("preserves existing readable finding IDs when components do not contain delimiters", () => {
    const id = buildFindingId({
      packageId: "agpl-child@0.1.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["fixture-bun-project", "permissive-parent@1.0.0", "agpl-child@0.1.0"]]
    });

    expect(id).toBe(
      "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0"
    );
  });

  test("escapes finding ID delimiters inside user-controlled components", () => {
    const idWithDelimiterInPackage = buildFindingId({
      packageId: "scope::pkg@1.0.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["root", "child"]]
    });
    const idWithDelimiterInPath = buildFindingId({
      packageId: "scope@1.0.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["root::pkg", "child"]]
    });

    expect(idWithDelimiterInPackage).toContain("scope%3A%3Apkg@1.0.0");
    expect(idWithDelimiterInPath).toContain("root%3A%3Apkg");
    expect(idWithDelimiterInPackage).not.toBe(idWithDelimiterInPath);
  });

  test("escapes percent before delimiter escapes to avoid encoded-value collisions", () => {
    const encodedDelimiter = buildFindingId({
      packageId: "scope%3A%3Apkg@1.0.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["root", "child"]]
    });
    const rawDelimiter = buildFindingId({
      packageId: "scope::pkg@1.0.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["root", "child"]]
    });

    expect(encodedDelimiter).toContain("scope%253A%253Apkg@1.0.0");
    expect(rawDelimiter).toContain("scope%3A%3Apkg@1.0.0");
    expect(encodedDelimiter).not.toBe(rawDelimiter);
  });

  test("escapes fingerprint delimiters inside reason and evidence components", () => {
    const fingerprint = buildFindingFingerprint({
      id: "package@1.0.0::production::direct::root>package@1.0.0",
      severity: "high",
      recommendation: "replace",
      reason: "reason::with>delimiters",
      evidence: ["license: MIT | Apache-2.0", "path > LICENSE"]
    });

    expect(
      fingerprint.startsWith("package@1.0.0::production::direct::root>package@1.0.0::high::replace::")
    ).toBe(true);
    expect(fingerprint).toContain("reason%3A%3Awith%3Edelimiters");
    expect(fingerprint).toContain("license%3A MIT %7C Apache-2.0");
    expect(fingerprint).toContain("path %3E LICENSE");
  });
});
