import { describe, expect, test } from "bun:test";

import {
  buildFindingFingerprint,
  buildFindingId,
  buildLegacyFindingId,
  buildSemanticFindingFingerprint
} from "../src/policy/finding-id";

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

test("canonicalizes unordered semantic license facts in finding fingerprints", () => {
  const input: Parameters<typeof buildSemanticFindingFingerprint>[0] = {
    id: "package@1.0.0::production::direct::root>package@1.0.0",
    severity: "high",
    recommendation: "replace",
    license: {
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      signals: ["metadata-conflict", "notice-required"],
      evidenceSources: ["package.json", "LICENSE"],
      confidence: "high",
      exceptions: ["Classpath-exception-2.0"]
    }
  };
  const reordered: Parameters<typeof buildSemanticFindingFingerprint>[0] = {
    ...input,
    license: {
      ...input.license,
      choices: ["Apache-2.0", "MIT", "MIT"],
      signals: ["notice-required", "metadata-conflict"],
      evidenceSources: ["LICENSE", "package.json"],
      exceptions: ["Classpath-exception-2.0", "Classpath-exception-2.0"]
    }
  };

  expect(buildSemanticFindingFingerprint(reordered)).toBe(
    buildSemanticFindingFingerprint(input)
  );
});

test("changes finding fingerprints when license semantics change", () => {
  const input: Parameters<typeof buildSemanticFindingFingerprint>[0] = {
    id: "package@1.0.0::production::direct::root>package@1.0.0",
    severity: "high",
    recommendation: "replace",
    license: {
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      signals: [],
      evidenceSources: ["package.json"],
      confidence: "high",
      exceptions: []
    }
  };
  const changed: Parameters<typeof buildSemanticFindingFingerprint>[0] = {
    ...input,
    license: {
      ...input.license,
      expression: "MIT AND Apache-2.0",
      joiner: "and"
    }
  };

  expect(buildSemanticFindingFingerprint(changed)).not.toBe(
    buildSemanticFindingFingerprint(input)
  );
});

  test("keeps finding IDs stable under path array permutation and duplicates", () => {
    const base = {
      packageId: "shared@1.0.2",
      dependencyType: "production" as const,
      dependencyScope: "transitive" as const
    };
    const forward = buildFindingId({
      ...base,
      paths: [["fixture-a", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"], ["fixture-b", "root@1.0.0", "mid-b@1.0.1", "shared@1.0.2"]]
    });
    const reversed = buildFindingId({
      ...base,
      paths: [["fixture-b", "root@1.0.0", "mid-b@1.0.1", "shared@1.0.2"], ["fixture-a", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"]]
    });
    const duplicated = buildFindingId({
      ...base,
      paths: [
        ["fixture-a", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"],
        ["fixture-b", "root@1.0.0", "mid-b@1.0.1", "shared@1.0.2"],
        ["fixture-a", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"]
      ]
    });

    expect(reversed).toBe(forward);
    expect(duplicated).toBe(forward);
    expect(forward).toBe(
      "shared@1.0.2::production::transitive::"
      + "fixture-a>root@1.0.0>mid-a@1.0.0>shared@1.0.2"
      + "|fixture-b>root@1.0.0>mid-b@1.0.1>shared@1.0.2"
    );
  });

  test("canonicalizes special and percent-encoded path segments by code unit", () => {
    const id = buildFindingId({
      packageId: "pkg@1.0.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["Ä", "b"], ["zz", "a"]]
    });

    expect(id).toBe("pkg@1.0.0::production::transitive::zz>a|Ä>b");

    const encoded = buildFindingId({
      packageId: "pkg@1.0.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["pkg%3Ascope", "z"], ["plain", "a"]]
    });
    const encodedReversed = buildFindingId({
      packageId: "pkg@1.0.0",
      dependencyType: "production",
      dependencyScope: "transitive",
      paths: [["plain", "a"], ["pkg%3Ascope", "z"]]
    });

    expect(encodedReversed).toBe(encoded);
    expect(encoded).toContain("pkg%253Ascope>z");
    expect(encoded).toContain("|plain>a");
  });

  test("changes finding identity when the path set changes", () => {
    const base = {
      packageId: "pkg@1.0.0",
      dependencyType: "production" as const,
      dependencyScope: "transitive" as const
    };
    const single = buildFindingId({
      ...base,
      paths: [["fixture", "parent@1.0.0", "pkg@1.0.0"]]
    });
    const withSecondParent = buildFindingId({
      ...base,
      paths: [
        ["fixture", "parent@1.0.0", "pkg@1.0.0"],
        ["fixture", "other@2.0.0", "pkg@1.0.0"]
      ]
    });

    expect(withSecondParent).not.toBe(single);
  });

  test("builds legacy raw-order finding IDs for waiver compatibility", () => {
    const input = {
      packageId: "shared@1.0.2",
      dependencyType: "production" as const,
      dependencyScope: "transitive" as const,
      paths: [
        ["fixture-b", "root@1.0.0", "mid-b@1.0.1", "shared@1.0.2"],
        ["fixture-a", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"]
      ]
    };

    expect(buildLegacyFindingId(input)).toBe(
      "shared@1.0.2::production::transitive::"
      + "fixture-b>root@1.0.0>mid-b@1.0.1>shared@1.0.2"
      + "|fixture-a>root@1.0.0>mid-a@1.0.0>shared@1.0.2"
    );
    expect(buildFindingId(input)).not.toBe(buildLegacyFindingId(input));
  });
});
