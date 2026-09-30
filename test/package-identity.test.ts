import { describe, expect, test } from "bun:test";
import { parseCycloneDxJsonText } from "../src/graph/cyclonedx-json";
import { parseSpdxJsonText } from "../src/graph/spdx-json";
import { normalizeAllLicenseEvidence } from "../src/license/normalize";
import { evaluateLicenseRisks } from "../src/policy/evaluate";

describe("SBOM package identity", () => {
  for (const format of ["cyclonedx", "spdx"] as const) {
    test(`${format} preserves cross-ecosystem license and dependency identity`, () => {
      const packages = ["npm", "pypi"].map((ecosystem) => ({
        ref: ecosystem, purl: `pkg:${ecosystem}/example@1.0.0`,
        license: ecosystem === "npm" ? "MIT" : "AGPL-3.0-only"
      }));
      const parse = (reversed: boolean) => {
        const entries = reversed ? [...packages].reverse() : packages;
        return format === "cyclonedx"
          ? parseCycloneDxJsonText(JSON.stringify({
              bomFormat: "CycloneDX", metadata: { component: { name: "app", "bom-ref": "app" } },
              components: entries.map((entry) => ({
                "bom-ref": entry.ref, purl: entry.purl, licenses: [{ expression: entry.license }]
              })),
              dependencies: [{ ref: "app", dependsOn: ["npm"] }, { ref: "npm", dependsOn: ["pypi"] }]
            }))
          : parseSpdxJsonText(JSON.stringify({
              spdxVersion: "SPDX-2.3", name: "app", documentDescribes: ["npm"],
              packages: entries.map((entry) => ({
                SPDXID: entry.ref, name: "example", licenseDeclared: entry.license,
                externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: entry.purl }]
              })),
              relationships: [{ spdxElementId: "npm", relationshipType: "DEPENDS_ON", relatedSpdxElement: "pypi" }]
            }));
      };
      const forward = parse(false);
      const reversed = parse(true);
      expect(forward.ok).toBe(true);
      expect(reversed.ok).toBe(true);
      if (!forward.ok || !reversed.ok) throw new Error("Expected valid cross-ecosystem SBOM");
      expect(forward.value.nodes).toEqual(reversed.value.nodes);
      expect(forward.value.nodes.map((node) => node.id)).toEqual(packages.map((entry) => entry.purl));
      expect(forward.value.nodes.find((node) => node.ecosystem === "pypi")?.paths)
        .toContainEqual(["app", packages[0]!.purl, packages[1]!.purl]);
      const findings = evaluateLicenseRisks({
        dependencies: forward.value.nodes, profile: "saas",
        licenses: normalizeAllLicenseEvidence(forward.value.embeddedEvidence ?? [])
      });
      expect(findings).toHaveLength(2);
      expect(findings.find((finding) => finding.packageId === packages[0]!.purl)?.severity).toBe("low");
      expect(findings.find((finding) => finding.packageId === packages[1]!.purl)?.severity).toBe("high");
    });
  }
});
