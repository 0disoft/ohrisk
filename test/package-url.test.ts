import { describe, expect, test } from "bun:test";

import type { DependencyNode } from "../src/graph/types";
import { parsePackageUrl } from "../src/graph/package-url";
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

  test("renders Cargo Package URLs", () => {
    expect(packageUrl(node({
      id: "serde_json@1.0.117",
      name: "serde_json",
      version: "1.0.117",
      ecosystem: "cargo"
    }))).toBe("pkg:cargo/serde_json@1.0.117");
  });

  test("renders Go Package URLs", () => {
    expect(packageUrl(node({
      id: "github.com/acme/risk@v1.0.0",
      name: "github.com/acme/risk",
      version: "v1.0.0",
      ecosystem: "go"
    }))).toBe("pkg:golang/github.com/acme/risk@v1.0.0");
  });

  test("renders NuGet Package URLs", () => {
    expect(packageUrl(node({
      id: "Risk.Package@1.0.0",
      name: "Risk.Package",
      version: "1.0.0",
      ecosystem: "nuget"
    }))).toBe("pkg:nuget/Risk.Package@1.0.0");
  });

  test("renders RubyGems Package URLs", () => {
    expect(packageUrl(node({
      id: "risk-gem@1.0.0",
      name: "risk-gem",
      version: "1.0.0",
      ecosystem: "gem"
    }))).toBe("pkg:gem/risk-gem@1.0.0");
  });

  test("renders Composer Package URLs", () => {
    expect(packageUrl(node({
      id: "acme/risk@1.0.0",
      name: "acme/risk",
      version: "1.0.0",
      ecosystem: "composer"
    }))).toBe("pkg:composer/acme/risk@1.0.0");
  });
});

describe("parsePackageUrl", () => {
  test("parses supported Package URL ecosystems", () => {
    expect(parsePackageUrl("pkg:npm/%40scope/package@1.2.3")).toEqual({
      ecosystem: "npm",
      name: "@scope/package",
      version: "1.2.3",
      id: "@scope/package@1.2.3"
    });

    expect(parsePackageUrl("pkg:pypi/Django.REST_framework@3.15.2")).toEqual({
      ecosystem: "pypi",
      name: "Django.REST_framework",
      version: "3.15.2",
      id: "Django.REST_framework@3.15.2"
    });

    expect(parsePackageUrl("pkg:maven/org.springframework/spring-core@6.1.1")).toEqual({
      ecosystem: "maven",
      name: "org.springframework:spring-core",
      version: "6.1.1",
      id: "org.springframework:spring-core@6.1.1"
    });

    expect(parsePackageUrl("pkg:cargo/serde_json@1.0.117")).toEqual({
      ecosystem: "cargo",
      name: "serde_json",
      version: "1.0.117",
      id: "serde_json@1.0.117"
    });

    expect(parsePackageUrl("pkg:golang/github.com/acme/risk@v1.0.0")).toEqual({
      ecosystem: "go",
      name: "github.com/acme/risk",
      version: "v1.0.0",
      id: "github.com/acme/risk@v1.0.0"
    });

    expect(parsePackageUrl("pkg:nuget/Risk.Package@1.0.0")).toEqual({
      ecosystem: "nuget",
      name: "Risk.Package",
      version: "1.0.0",
      id: "Risk.Package@1.0.0"
    });

    expect(parsePackageUrl("pkg:gem/risk-gem@1.0.0")).toEqual({
      ecosystem: "gem",
      name: "risk-gem",
      version: "1.0.0",
      id: "risk-gem@1.0.0"
    });

    expect(parsePackageUrl("pkg:composer/acme/risk@1.0.0")).toEqual({
      ecosystem: "composer",
      name: "acme/risk",
      version: "1.0.0",
      id: "acme/risk@1.0.0"
    });
  });

  test("ignores unsupported or incomplete Package URLs", () => {
    expect(parsePackageUrl("pkg:deb/debian/curl@1.0.0")).toBeUndefined();
    expect(parsePackageUrl("pkg:npm/package")).toBeUndefined();
    expect(parsePackageUrl("not-a-purl")).toBeUndefined();
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
