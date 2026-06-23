import { describe, expect, test } from "bun:test";

import { parseCondaLockText } from "../src/graph/conda-lock";

describe("parseCondaLockText", () => {
  test("parses conda-lock package records and dependency paths", () => {
    const result = parseCondaLockText([
      "version: 1",
      "metadata:",
      "  sources:",
      "    - environment.yml",
      "package:",
      "  - name: python",
      "    version: '3.12.1'",
      "    manager: conda",
      "    platform: linux-64",
      "    dependencies: {}",
      "    url: https://conda.anaconda.org/conda-forge/linux-64/python-3.12.1-hab00c5b_0.conda",
      "    category: main",
      "  - name: risk-conda",
      "    version: '1.0.0'",
      "    manager: conda",
      "    platform: linux-64",
      "    dependencies:",
      "      python: '>=3.12'",
      "    url: https://conda.anaconda.org/conda-forge/linux-64/risk-conda-1.0.0-py312_0.tar.bz2",
      "    category: main",
      "  - name: risk-pip",
      "    version: '2.0.0'",
      "    manager: pip",
      "    platform: linux-64",
      "    dependencies: {}",
      "    url: https://files.pythonhosted.org/packages/risk-pip-2.0.0.tar.gz",
      "    category: dev"
    ].join("\n"), "fixtures/conda-lock.yml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected conda-lock parse to succeed.");
    }

    expect(result.value.rootName).toBe("environment");
    expect(result.value.nodes).toEqual([
      {
        id: "conda:python@3.12.1",
        name: "python",
        version: "3.12.1",
        ecosystem: "conda",
        resolved: "https://conda.anaconda.org/conda-forge/linux-64/python-3.12.1-hab00c5b_0.conda",
        dependencyType: "production",
        direct: false,
        paths: [[
          "environment:linux-64",
          "conda:risk-conda@1.0.0",
          "conda:python@3.12.1"
        ]]
      },
      {
        id: "conda:risk-conda@1.0.0",
        name: "risk-conda",
        version: "1.0.0",
        ecosystem: "conda",
        resolved: "https://conda.anaconda.org/conda-forge/linux-64/risk-conda-1.0.0-py312_0.tar.bz2",
        dependencyType: "production",
        direct: true,
        paths: [["environment:linux-64", "conda:risk-conda@1.0.0"]]
      },
      {
        id: "pypi:risk-pip@2.0.0",
        name: "risk-pip",
        version: "2.0.0",
        ecosystem: "pypi",
        resolved: "https://files.pythonhosted.org/packages/risk-pip-2.0.0.tar.gz",
        dependencyType: "development",
        direct: true,
        paths: [["environment:linux-64", "pypi:risk-pip@2.0.0"]]
      }
    ]);
  });

  test("reports malformed package records as typed errors", () => {
    const result = parseCondaLockText([
      "version: 1",
      "package:",
      "  - name: risk-conda",
      "    version: '1.0.0'"
    ].join("\n"), "conda-lock.yml");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed conda-lock.yml to fail.");
    }

    expect(result.error.code).toBe("CONDA_LOCK_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      lockfilePath: "conda-lock.yml",
      index: 0,
      reason: "missing_package_identity"
    });
  });
});
