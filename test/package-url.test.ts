import { describe, expect, test } from "bun:test";

import type { DependencyNode } from "../src/graph/types";
import { packageUrl } from "../src/report/package-url";

describe("packageUrl", () => {
  test("renders npm Package URLs with scoped package names encoded by segment", () => {
    expect(packageUrl(node({
      id: "@scope/package@1.2.3",
      name: "@scope/package",
      version: "1.2.3",
      ecosystem: "npm"
    }))).toBe("pkg:npm/%40scope/package@1.2.3");
  });

  test("renders PyPI Package URLs with normalized package names", () => {
    expect(packageUrl(node({
      id: "Django.REST_framework@3.15.2",
      name: "Django.REST_framework",
      version: "3.15.2",
      ecosystem: "pypi"
    }))).toBe("pkg:pypi/django-rest-framework@3.15.2");
  });

  test("renders Maven Package URLs from group and artifact coordinates", () => {
    expect(packageUrl(node({
      id: "org.springframework:spring-core@6.1.1",
      name: "org.springframework:spring-core",
      version: "6.1.1",
      ecosystem: "maven"
    }))).toBe("pkg:maven/org.springframework/spring-core@6.1.1");
  });
});

function node(input: {
  id: string;
  name: string;
  version: string;
  ecosystem: DependencyNode["ecosystem"];
}): DependencyNode {
  return {
    ...input,
    dependencyType: "production",
    direct: true,
    paths: [["root", input.id]]
  };
}
