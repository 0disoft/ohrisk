import path from "node:path";
import { describe, expect, test } from "bun:test";

import { parseRenvLockText } from "../src/graph/r-renv-lock";

describe("parseRenvLockText", () => {
  test("parses renv package records", () => {
    const result = parseRenvLockText(JSON.stringify({
      R: {
        Version: "4.4.1"
      },
      Packages: {
        RiskR: {
          Package: "RiskR",
          Version: "1.2.3",
          Source: "Repository",
          Repository: "CRAN"
        },
        TransitiveR: {
          Package: "TransitiveR",
          Version: "0.2.0",
          Source: "GitHub",
          RemoteUrl: "https://github.com/acme/transitive-r"
        }
      }
    }), path.join("analysis", "renv.lock"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("analysis");
    expect(result.value.nodes).toEqual([
      {
        id: "RiskR@1.2.3",
        name: "RiskR",
        version: "1.2.3",
        ecosystem: "cran",
        resolved: "CRAN",
        dependencyType: "unknown",
        direct: true,
        paths: [["analysis", "RiskR@1.2.3"]]
      },
      {
        id: "TransitiveR@0.2.0",
        name: "TransitiveR",
        version: "0.2.0",
        ecosystem: "cran",
        resolved: "https://github.com/acme/transitive-r",
        dependencyType: "unknown",
        direct: true,
        paths: [["analysis", "TransitiveR@0.2.0"]]
      }
    ]);
  });

  test("reports malformed renv package records as typed errors", () => {
    const result = parseRenvLockText(JSON.stringify({
      Packages: {
        RiskR: {
          Package: "RiskR"
        }
      }
    }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("RENV_LOCK_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      packageName: "RiskR",
      reason: "missing_package_or_version"
    });
  });

  test("uses DESCRIPTION dependency fields for root dependency classification", () => {
    const result = parseRenvLockText(JSON.stringify({
      R: {
        Version: "4.4.1"
      },
      Packages: {
        RiskR: {
          Package: "RiskR",
          Version: "1.2.3",
          Source: "Repository",
          Repository: "CRAN"
        },
        DevRiskR: {
          Package: "DevRiskR",
          Version: "2.0.0",
          Source: "Repository",
          Repository: "CRAN"
        },
        UnknownR: {
          Package: "UnknownR",
          Version: "0.1.0",
          Source: "Repository",
          Repository: "CRAN"
        }
      }
    }), path.join("analysis", "renv.lock"), {
      descriptionText: [
        "Package: FixtureR",
        "Version: 0.0.0",
        "Depends: R (>= 4.4)",
        "Imports: RiskR (>= 1.0.0),",
        "    MissingR",
        "Suggests: DevRiskR",
        "Enhances: RiskR"
      ].join("\n")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "RiskR@1.2.3"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["analysis", "RiskR@1.2.3"]]
      });
    expect(result.value.nodes.find((node) => node.id === "DevRiskR@2.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true,
        paths: [["analysis", "DevRiskR@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "UnknownR@0.1.0"))
      .toMatchObject({
        dependencyType: "unknown",
        direct: true,
        paths: [["analysis", "UnknownR@0.1.0"]]
      });
  });
});
