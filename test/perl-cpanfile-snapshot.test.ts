import path from "node:path";
import { describe, expect, test } from "bun:test";

import { parseCpanfileSnapshotText } from "../src/graph/perl-cpanfile-snapshot";

describe("parseCpanfileSnapshotText", () => {
  test("parses Carton snapshot distributions and requirement paths", () => {
    const result = parseCpanfileSnapshotText(cpanfileSnapshotText(), path.join("fixture-perl", "cpanfile.snapshot"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-perl");
    expect(result.value.nodes).toEqual([
      {
        id: "App-Risk@1.0",
        name: "App-Risk",
        version: "1.0",
        ecosystem: "cpan",
        resolved: "A/AC/ACME/App-Risk-1.0.tar.gz",
        dependencyType: "unknown",
        direct: true,
        paths: [["fixture-perl", "App-Risk@1.0"]]
      },
      {
        id: "CPAN-Meta-Requirements@2.143",
        name: "CPAN-Meta-Requirements",
        version: "2.143",
        ecosystem: "cpan",
        resolved: "R/RJ/RJBS/CPAN-Meta-Requirements-2.143.tar.gz",
        dependencyType: "unknown",
        direct: false,
        paths: [["fixture-perl", "App-Risk@1.0", "CPAN-Meta-Requirements@2.143"]]
      }
    ]);
  });

  test("stops walking CPAN distribution cycles without dropping reachable paths", () => {
    const result = parseCpanfileSnapshotText([
      "# carton snapshot format: version 1.0",
      "DISTRIBUTIONS",
      "  App-Risk-1.0",
      "    pathname: A/AC/ACME/App-Risk-1.0.tar.gz",
      "    provides:",
      "      App::Risk 1.0",
      "    requirements:",
      "      Cycle::A 1.0",
      "  Cycle-A-1.0",
      "    pathname: C/CY/CYCLE/Cycle-A-1.0.tar.gz",
      "    provides:",
      "      Cycle::A 1.0",
      "    requirements:",
      "      Cycle::B 1.0",
      "  Cycle-B-1.0",
      "    pathname: C/CY/CYCLE/Cycle-B-1.0.tar.gz",
      "    provides:",
      "      Cycle::B 1.0",
      "    requirements:",
      "      Cycle::A 1.0",
      "      Leaf::Module 1.0",
      "  Leaf-Module-1.0",
      "    pathname: L/LE/LEAF/Leaf-Module-1.0.tar.gz",
      "    provides:",
      "      Leaf::Module 1.0",
      "    requirements:",
      "      perl 5.010000"
    ].join("\n"), path.join("fixture-perl", "cpanfile.snapshot"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "App-Risk@1.0",
      "Cycle-A@1.0",
      "Cycle-B@1.0",
      "Leaf-Module@1.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "Cycle-B@1.0")?.paths)
      .toContainEqual(["fixture-perl", "App-Risk@1.0", "Cycle-A@1.0", "Cycle-B@1.0"]);
    expect(result.value.nodes.find((node) => node.id === "Leaf-Module@1.0")?.paths)
      .toContainEqual([
        "fixture-perl",
        "App-Risk@1.0",
        "Cycle-A@1.0",
        "Cycle-B@1.0",
        "Leaf-Module@1.0"
      ]);
  });

  test("reports snapshots without distributions as typed errors", () => {
    const result = parseCpanfileSnapshotText([
      "# carton snapshot format: version 1.0",
      "DISTRIBUTIONS"
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected cpanfile.snapshot parse failure.");
    }

    expect(result.error.code).toBe("CPANFILE_SNAPSHOT_PARSE_FAILED");
  });
});

function cpanfileSnapshotText(): string {
  return [
    "# carton snapshot format: version 1.0",
    "DISTRIBUTIONS",
    "  CPAN-Meta-Requirements-2.143",
    "    pathname: R/RJ/RJBS/CPAN-Meta-Requirements-2.143.tar.gz",
    "    provides:",
    "      CPAN::Meta::Requirements 2.143",
    "    requirements:",
    "      ExtUtils::MakeMaker 6.17",
    "      perl 5.010000",
    "  App-Risk-1.0",
    "    pathname: A/AC/ACME/App-Risk-1.0.tar.gz",
    "    provides:",
    "      App::Risk 1.0",
    "    requirements:",
    "      CPAN::Meta::Requirements 2.143"
  ].join("\n");
}
