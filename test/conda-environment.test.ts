import { describe, expect, test } from "bun:test";

import { parseCondaEnvironmentText } from "../src/graph/conda-environment";

describe("parseCondaEnvironmentText", () => {
  test("parses exact Conda and pip pins from environment.yml", () => {
    const result = parseCondaEnvironmentText([
      "name: fixture-conda-env",
      "channels:",
      "  - conda-forge",
      "dependencies:",
      "  - python=3.12.1",
      "  - conda-forge::risk-conda=1.0.0=py312_0",
      "  - pip:",
      "      - risk-pip==2.0.0"
    ].join("\n"), "environment.yml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected environment.yml parse to succeed.");
    }

    expect(result.value.rootName).toBe("fixture-conda-env");
    expect(result.value.nodes).toEqual([
      {
        id: "conda:python@3.12.1",
        name: "python",
        version: "3.12.1",
        ecosystem: "conda",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-conda-env", "conda:python@3.12.1"]]
      },
      {
        id: "conda:risk-conda@1.0.0",
        name: "risk-conda",
        version: "1.0.0",
        ecosystem: "conda",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-conda-env", "conda:risk-conda@1.0.0"]]
      },
      {
        id: "pypi:risk-pip@2.0.0",
        name: "risk-pip",
        version: "2.0.0",
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-conda-env", "pypi:risk-pip@2.0.0"]]
      }
    ]);
  });

  test("reports unpinned dependencies as typed errors", () => {
    const result = parseCondaEnvironmentText([
      "name: fixture-conda-env",
      "dependencies:",
      "  - python>=3.12"
    ].join("\n"), "environment.yml");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected environment.yml parse to fail.");
    }

    expect(result.error.code).toBe("CONDA_ENVIRONMENT_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      lockfilePath: "environment.yml",
      index: 0,
      entry: "python>=3.12",
      reason: "unsupported_conda_dependency"
    });
  });
});
