import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectHelmChartEvidence } from "../src/evidence/helm-chart";

describe("collectHelmChartEvidence", () => {
  test("reads local chart license metadata and files", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-helm-evidence-"));
    const chartRoot = path.join(projectRoot, "charts", "postgresql");

    try {
      mkdirSync(chartRoot, { recursive: true });
      writeFileSync(
        path.join(chartRoot, "Chart.yaml"),
        [
          "apiVersion: v2",
          "name: postgresql",
          "version: 15.5.0",
          "annotations:",
          "  artifacthub.io/license: Apache-2.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(chartRoot, "LICENSE"), "Apache License Version 2.0", "utf8");

      const result = collectHelmChartEvidence({
        packageId: "https://charts.bitnami.com/bitnami/postgresql@15.5.0",
        chartName: "postgresql",
        version: "15.5.0",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.metadataLicense).toBe("Apache-2.0");
      expect(result.value.metadataSource).toBe("Chart.yaml");
      expect(result.value.files).toEqual([
        {
          path: "LICENSE",
          kind: "license",
          text: "Apache License Version 2.0"
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Helm chart evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-helm-evidence-limit-"));
    const chartRoot = path.join(projectRoot, "charts", "postgresql");

    try {
      mkdirSync(chartRoot, { recursive: true });
      writeFileSync(
        path.join(chartRoot, "Chart.yaml"),
        [
          "apiVersion: v2",
          "name: postgresql",
          "version: 15.5.0",
          "license: Apache-2.0"
        ].join("\n"),
        "utf8"
      );
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(
          path.join(chartRoot, `LICENSE-${suffix}.txt`),
          `license ${suffix}`,
          "utf8"
        );
      }

      const result = collectHelmChartEvidence({
        packageId: "https://charts.bitnami.com/bitnami/postgresql@15.5.0",
        chartName: "postgresql",
        version: "15.5.0",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.files).toHaveLength(50);
      expect(result.value.warnings).toContain(
        "Helm chart evidence file limit reached at 50 files."
      );
      expect(result.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Helm chart source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
