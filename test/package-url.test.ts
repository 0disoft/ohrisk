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

  test("renders Conan Package URLs", () => {
    expect(packageUrl(node({
      id: "risklib@1.0.0",
      name: "risklib",
      version: "1.0.0",
      ecosystem: "conan"
    }))).toBe("pkg:conan/risklib@1.0.0");
  });

  test("renders Conda Package URLs", () => {
    expect(packageUrl(node({
      id: "conda:risk-conda@1.0.0",
      name: "risk-conda",
      version: "1.0.0",
      ecosystem: "conda"
    }))).toBe("pkg:conda/risk-conda@1.0.0");
  });

  test("renders Bazel module Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "rules_cc@0.0.9",
      name: "rules_cc",
      version: "0.0.9",
      ecosystem: "bazel"
    }))).toBe("pkg:generic/bazel-module/rules_cc@0.0.9");
  });

  test("renders vcpkg Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "zlib@1.3.1",
      name: "zlib",
      version: "1.3.1",
      ecosystem: "vcpkg"
    }))).toBe("pkg:generic/vcpkg/zlib@1.3.1");
  });

  test("renders Terraform provider Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "registry.terraform.io/hashicorp/aws@5.31.0",
      name: "registry.terraform.io/hashicorp/aws",
      version: "5.31.0",
      ecosystem: "terraform"
    }))).toBe("pkg:generic/terraform-provider/registry.terraform.io/hashicorp/aws@5.31.0");
  });

  test("renders Helm chart Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "https://charts.bitnami.com/bitnami/postgresql@15.5.0",
      name: "https://charts.bitnami.com/bitnami/postgresql",
      installNames: ["postgresql"],
      resolved: "https://charts.bitnami.com/bitnami",
      version: "15.5.0",
      ecosystem: "helm"
    }))).toBe("pkg:generic/helm/https%3A%2F%2Fcharts.bitnami.com%2Fbitnami/postgresql@15.5.0");
  });

  test("renders Nix flake input Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "github:NixOS/nixpkgs@0123456789abcdef",
      name: "github:NixOS/nixpkgs",
      version: "0123456789abcdef",
      ecosystem: "nix"
    }))).toBe("pkg:generic/nix/github%3ANixOS/nixpkgs@0123456789abcdef");
  });

  test("renders Unity Package Manager Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "com.acme.risk@1.2.3",
      name: "com.acme.risk",
      version: "1.2.3",
      ecosystem: "unity"
    }))).toBe("pkg:generic/unity/com.acme.risk@1.2.3");
  });

  test("renders CRAN Package URLs", () => {
    expect(packageUrl(node({
      id: "RiskR@1.2.3",
      name: "RiskR",
      version: "1.2.3",
      ecosystem: "cran"
    }))).toBe("pkg:cran/RiskR@1.2.3");
  });

  test("renders Julia Package URLs", () => {
    expect(packageUrl(node({
      id: "RiskJulia@1.2.3",
      name: "RiskJulia",
      version: "1.2.3",
      ecosystem: "julia"
    }))).toBe("pkg:julia/RiskJulia@1.2.3");
  });

  test("renders Hackage Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "risk-haskell@1.2.3",
      name: "risk-haskell",
      version: "1.2.3",
      ecosystem: "hackage"
    }))).toBe("pkg:generic/hackage/risk-haskell@1.2.3");
  });

  test("renders CPAN Package URLs with author namespaces from pathnames", () => {
    expect(packageUrl(node({
      id: "CPAN-Meta-Requirements@2.143",
      name: "CPAN-Meta-Requirements",
      version: "2.143",
      ecosystem: "cpan",
      resolved: "R/RJ/RJBS/CPAN-Meta-Requirements-2.143.tar.gz"
    }))).toBe("pkg:cpan/RJBS/CPAN-Meta-Requirements@2.143");
  });

  test("renders LuaRocks Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "lua-cjson@2.1.0-1",
      name: "lua-cjson",
      version: "2.1.0-1",
      ecosystem: "luarocks"
    }))).toBe("pkg:generic/luarocks/lua-cjson@2.1.0-1");
  });

  test("renders Carthage Package URLs as generic Package URLs", () => {
    expect(packageUrl(node({
      id: "Acme/RiskKit@1.2.3",
      name: "Acme/RiskKit",
      version: "1.2.3",
      ecosystem: "carthage"
    }))).toBe("pkg:generic/carthage/Acme/RiskKit@1.2.3");
  });

  test("renders CocoaPods Package URLs", () => {
    expect(packageUrl(node({
      id: "RiskPod@1.0.0",
      name: "RiskPod",
      version: "1.0.0",
      ecosystem: "cocoapods"
    }))).toBe("pkg:cocoapods/RiskPod@1.0.0");
  });

  test("renders Hex Package URLs", () => {
    expect(packageUrl(node({
      id: "risk_hex@1.0.0",
      name: "risk_hex",
      version: "1.0.0",
      ecosystem: "hex"
    }))).toBe("pkg:hex/risk_hex@1.0.0");
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

  test("renders Dart Pub Package URLs", () => {
    expect(packageUrl(node({
      id: "risk_package@1.0.0",
      name: "risk_package",
      version: "1.0.0",
      ecosystem: "pub"
    }))).toBe("pkg:pub/risk_package@1.0.0");
  });

  test("renders Swift Package URLs", () => {
    expect(packageUrl(node({
      id: "risk-swift@1.0.0",
      name: "risk-swift",
      version: "1.0.0",
      ecosystem: "swift"
    }))).toBe("pkg:swift/risk-swift@1.0.0");
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

    expect(parsePackageUrl("pkg:conan/risklib@1.0.0")).toEqual({
      ecosystem: "conan",
      name: "risklib",
      version: "1.0.0",
      id: "risklib@1.0.0"
    });

    expect(parsePackageUrl("pkg:conan/example.com/risklib@1.0.0?user=acme&channel=stable")).toEqual({
      ecosystem: "conan",
      name: "example.com/risklib",
      version: "1.0.0",
      id: "example.com/risklib@1.0.0"
    });

    expect(parsePackageUrl("pkg:conda/risk-conda@1.0.0")).toEqual({
      ecosystem: "conda",
      name: "risk-conda",
      version: "1.0.0",
      id: "conda:risk-conda@1.0.0"
    });

    expect(parsePackageUrl("pkg:generic/bazel-module/rules_cc@0.0.9")).toEqual({
      ecosystem: "bazel",
      name: "rules_cc",
      version: "0.0.9",
      id: "rules_cc@0.0.9"
    });

    expect(parsePackageUrl("pkg:generic/vcpkg/zlib@1.3.1")).toEqual({
      ecosystem: "vcpkg",
      name: "zlib",
      version: "1.3.1",
      id: "zlib@1.3.1"
    });

    expect(parsePackageUrl("pkg:generic/terraform-provider/registry.terraform.io/hashicorp/aws@5.31.0")).toEqual({
      ecosystem: "terraform",
      name: "registry.terraform.io/hashicorp/aws",
      version: "5.31.0",
      id: "registry.terraform.io/hashicorp/aws@5.31.0"
    });

    expect(parsePackageUrl("pkg:generic/helm/https%3A%2F%2Fcharts.bitnami.com%2Fbitnami/postgresql@15.5.0")).toEqual({
      ecosystem: "helm",
      name: "https://charts.bitnami.com/bitnami/postgresql",
      version: "15.5.0",
      id: "https://charts.bitnami.com/bitnami/postgresql@15.5.0"
    });

    expect(parsePackageUrl("pkg:generic/nix/github%3ANixOS/nixpkgs@0123456789abcdef")).toEqual({
      ecosystem: "nix",
      name: "github:NixOS/nixpkgs",
      version: "0123456789abcdef",
      id: "github:NixOS/nixpkgs@0123456789abcdef"
    });

    expect(parsePackageUrl("pkg:generic/unity/com.acme.risk@1.2.3")).toEqual({
      ecosystem: "unity",
      name: "com.acme.risk",
      version: "1.2.3",
      id: "com.acme.risk@1.2.3"
    });

    expect(parsePackageUrl("pkg:cran/RiskR@1.2.3")).toEqual({
      ecosystem: "cran",
      name: "RiskR",
      version: "1.2.3",
      id: "RiskR@1.2.3"
    });

    expect(parsePackageUrl("pkg:julia/RiskJulia@1.2.3")).toEqual({
      ecosystem: "julia",
      name: "RiskJulia",
      version: "1.2.3",
      id: "RiskJulia@1.2.3"
    });

    expect(parsePackageUrl("pkg:generic/hackage/risk-haskell@1.2.3")).toEqual({
      ecosystem: "hackage",
      name: "risk-haskell",
      version: "1.2.3",
      id: "risk-haskell@1.2.3"
    });

    expect(parsePackageUrl("pkg:cpan/RJBS/CPAN-Meta-Requirements@2.143")).toEqual({
      ecosystem: "cpan",
      name: "CPAN-Meta-Requirements",
      version: "2.143",
      id: "CPAN-Meta-Requirements@2.143"
    });

    expect(parsePackageUrl("pkg:generic/luarocks/lua-cjson@2.1.0-1")).toEqual({
      ecosystem: "luarocks",
      name: "lua-cjson",
      version: "2.1.0-1",
      id: "lua-cjson@2.1.0-1"
    });

    expect(parsePackageUrl("pkg:generic/carthage/Acme/RiskKit@1.2.3")).toEqual({
      ecosystem: "carthage",
      name: "Acme/RiskKit",
      version: "1.2.3",
      id: "Acme/RiskKit@1.2.3"
    });

    expect(parsePackageUrl("pkg:cocoapods/RiskPod@1.0.0")).toEqual({
      ecosystem: "cocoapods",
      name: "RiskPod",
      version: "1.0.0",
      id: "RiskPod@1.0.0"
    });

    expect(parsePackageUrl("pkg:hex/risk_hex@1.0.0")).toEqual({
      ecosystem: "hex",
      name: "risk_hex",
      version: "1.0.0",
      id: "risk_hex@1.0.0"
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

    expect(parsePackageUrl("pkg:pub/risk_package@1.0.0")).toEqual({
      ecosystem: "pub",
      name: "risk_package",
      version: "1.0.0",
      id: "risk_package@1.0.0"
    });

    expect(parsePackageUrl("pkg:swift/risk-swift@1.0.0")).toEqual({
      ecosystem: "swift",
      name: "risk-swift",
      version: "1.0.0",
      id: "risk-swift@1.0.0"
    });
  });

  test("ignores unsupported or incomplete Package URLs", () => {
    expect(parsePackageUrl("pkg:deb/debian/curl@1.0.0")).toBeUndefined();
    expect(parsePackageUrl("pkg:generic/RiskKit@1.2.3")).toBeUndefined();
    expect(parsePackageUrl("pkg:npm/package")).toBeUndefined();
    expect(parsePackageUrl("not-a-purl")).toBeUndefined();
  });
});

function node(input: {
  id: string;
  name: string;
  version: string;
  ecosystem: DependencyNode["ecosystem"];
  installNames?: string[];
  resolved?: string;
}): DependencyNode {
  return {
    ...input,
    dependencyType: "production",
    direct: true,
    paths: [["root", input.id]]
  };
}
