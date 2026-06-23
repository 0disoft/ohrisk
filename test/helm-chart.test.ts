import { describe, expect, test } from "bun:test";

import { parseHelmChartText } from "../src/graph/helm-chart";

describe("parseHelmChartText", () => {
  test("parses Helm Chart.lock dependencies", () => {
    const result = parseHelmChartText([
      "dependencies:",
      "  - name: postgresql",
      "    repository: https://charts.bitnami.com/bitnami",
      "    version: 15.5.0",
      "    digest: sha256:abc",
      "  - name: redis",
      "    repository: oci://registry-1.docker.io/bitnamicharts",
      "    version: 19.1.0"
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      {
        id: "https://charts.bitnami.com/bitnami/postgresql@15.5.0",
        name: "https://charts.bitnami.com/bitnami/postgresql",
        installNames: ["postgresql"],
        version: "15.5.0",
        ecosystem: "helm",
        resolved: "https://charts.bitnami.com/bitnami",
        integrity: "sha256:abc",
        dependencyType: "production",
        direct: true,
        paths: [[".", "https://charts.bitnami.com/bitnami/postgresql@15.5.0"]]
      },
      {
        id: "oci://registry-1.docker.io/bitnamicharts/redis@19.1.0",
        name: "oci://registry-1.docker.io/bitnamicharts/redis",
        installNames: ["redis"],
        version: "19.1.0",
        ecosystem: "helm",
        resolved: "oci://registry-1.docker.io/bitnamicharts",
        dependencyType: "production",
        direct: true,
        paths: [[".", "oci://registry-1.docker.io/bitnamicharts/redis@19.1.0"]]
      }
    ]);
  });

  test("allows Helm charts without dependencies", () => {
    const result = parseHelmChartText([
      "apiVersion: v2",
      "name: app",
      "version: 0.1.0"
    ].join("\n"), "Chart.yaml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([]);
  });
});
