import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePnpmLockfile, parsePnpmLockText } from "../src/graph/npm-pnpm-lock";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parsePnpmLockfile", () => {
  test("parses direct and transitive dependencies from a pnpm-lock.yaml", () => {
    const result = parsePnpmLockfile(
      path.join(fixturesDir, "pnpm-project", "pnpm-lock.yaml")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "dev-risk@3.0.0",
      "dual-license@2.0.0",
      "gpl-package@5.0.0",
      "missing-license@4.0.0",
      "permissive-parent@1.0.0"
    ]);

    const parent = result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0");
    expect(parent?.direct).toBe(true);
    expect(parent?.dependencyType).toBe("production");
    expect(parent?.resolved).toBe("file:../bun-project/.registry/permissive-parent");
    expect(parent?.paths).toEqual([
      ["<root>", "permissive-parent@1.0.0"]
    ]);

    const child = result.value.nodes.find((node) => node.id === "agpl-child@0.1.0");
    expect(child?.direct).toBe(false);
    expect(child?.dependencyType).toBe("production");
    expect(child?.resolved).toBe("file:../bun-project/.registry/agpl-child");
    expect(child?.paths).toEqual([
      ["<root>", "permissive-parent@1.0.0", "agpl-child@0.1.0"]
    ]);

    const devRisk = result.value.nodes.find((node) => node.id === "dev-risk@3.0.0");
    expect(devRisk?.direct).toBe(true);
    expect(devRisk?.dependencyType).toBe("development");
  });

  test("reports malformed pnpm lockfiles as typed errors", () => {
    const result = parsePnpmLockText(":\n  - not yaml", "broken-pnpm-lock.yaml");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed lockfile to fail.");
    }

    expect(result.error.code).toBe("PNPM_LOCK_PARSE_FAILED");
  });

  test("reports pnpm lockfiles without importers as unsupported input", () => {
    const result = parsePnpmLockText(
      "lockfileVersion: '9.0'\npackages: {}\n",
      "missing-importers-pnpm-lock.yaml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing importers to fail.");
    }

    expect(result.error.code).toBe("PNPM_LOCK_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
  });

  test("resolves npm alias dependencies to the actual package identity", () => {
    const result = parsePnpmLockText(
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      compat-parent:",
        "        specifier: npm:permissive-parent@1.0.0",
        "        version: npm:permissive-parent@1.0.0",
        "packages:",
        "  /permissive-parent@1.0.0:",
        "    resolution:",
        "      directory: ../bun-project/.registry/permissive-parent",
        "  /agpl-child@0.1.0:",
        "    resolution:",
        "      directory: ../bun-project/.registry/agpl-child",
        "snapshots:",
        "  /permissive-parent@1.0.0:",
        "    dependencies:",
        "      compat-child: npm:agpl-child@0.1.0",
        "  /agpl-child@0.1.0: {}"
      ].join("\n"),
      "alias-pnpm-lock.yaml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        name: "permissive-parent",
        installNames: ["compat-parent"],
        direct: true,
        paths: [["<root>", "compat-parent -> permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@0.1.0"))
      .toMatchObject({
        name: "agpl-child",
        installNames: ["compat-child"],
        direct: false,
        paths: [[
          "<root>",
          "compat-parent -> permissive-parent@1.0.0",
          "compat-child -> agpl-child@0.1.0"
        ]]
      });
  });

  test("resolves pnpm alias package keys to the actual package identity", () => {
    const result = parsePnpmLockText(
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      compat-parent:",
        "        specifier: npm:permissive-parent@1.0.0",
        "        version: compat-parent@npm:permissive-parent@1.0.0",
        "packages:",
        "  compat-parent@npm:permissive-parent@1.0.0:",
        "    resolution:",
        "      directory: ../bun-project/.registry/permissive-parent",
        "  compat-child@npm:agpl-child@0.1.0:",
        "    resolution:",
        "      directory: ../bun-project/.registry/agpl-child",
        "snapshots:",
        "  compat-parent@npm:permissive-parent@1.0.0:",
        "    dependencies:",
        "      compat-child: compat-child@npm:agpl-child@0.1.0",
        "  compat-child@npm:agpl-child@0.1.0: {}"
      ].join("\n"),
      "alias-key-pnpm-lock.yaml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        name: "permissive-parent",
        installNames: ["compat-parent"],
        direct: true,
        paths: [["<root>", "compat-parent -> permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@0.1.0"))
      .toMatchObject({
        name: "agpl-child",
        installNames: ["compat-child"],
        direct: false,
        paths: [[
          "<root>",
          "compat-parent -> permissive-parent@1.0.0",
          "compat-child -> agpl-child@0.1.0"
        ]]
      });
  });

  test("keeps nested optional and peer dependency edges from snapshots", () => {
    const result = parsePnpmLockText(
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      prod-parent:",
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "packages:",
        "  /prod-parent@1.0.0: {}",
        "  /regular-child@1.0.0: {}",
        "  /optional-child@1.0.0: {}",
        "  /peer-child@1.0.0: {}",
        "snapshots:",
        "  /prod-parent@1.0.0:",
        "    dependencies:",
        "      regular-child: 1.0.0",
        "    optionalDependencies:",
        "      optional-child: 1.0.0",
        "    peerDependencies:",
        "      peer-child: 1.0.0",
        "  /regular-child@1.0.0: {}",
        "  /optional-child@1.0.0: {}",
        "  /peer-child@1.0.0: {}"
      ].join("\n"),
      "nested-edges-pnpm-lock.yaml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "optional-child@1.0.0",
      "peer-child@1.0.0",
      "prod-parent@1.0.0",
      "regular-child@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "regular-child@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [["<root>", "prod-parent@1.0.0", "regular-child@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "optional-child@1.0.0"))
      .toMatchObject({
        dependencyType: "optional",
        direct: false,
        paths: [["<root>", "prod-parent@1.0.0", "optional-child@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "peer-child@1.0.0"))
      .toMatchObject({
        dependencyType: "peer",
        direct: false,
        paths: [["<root>", "prod-parent@1.0.0", "peer-child@1.0.0"]]
      });
  });

  test("uses every pnpm importer as a dependency graph root", () => {
    const result = parsePnpmLockText(
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  apps/web:",
        "    dependencies:",
        "      workspace-prod:",
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "  packages/tools:",
        "    devDependencies:",
        "      workspace-dev:",
        "        specifier: 2.0.0",
        "        version: 2.0.0",
        "packages:",
        "  /workspace-prod@1.0.0: {}",
        "  /workspace-child@0.1.0: {}",
        "  /workspace-dev@2.0.0: {}",
        "snapshots:",
        "  /workspace-prod@1.0.0:",
        "    dependencies:",
        "      workspace-child: 0.1.0",
        "  /workspace-child@0.1.0: {}",
        "  /workspace-dev@2.0.0: {}"
      ].join("\n"),
      "multi-importer-pnpm-lock.yaml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "workspace-child@0.1.0",
      "workspace-dev@2.0.0",
      "workspace-prod@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "workspace-prod@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["apps/web", "workspace-prod@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-child@0.1.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [["apps/web", "workspace-prod@1.0.0", "workspace-child@0.1.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-dev@2.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true,
        paths: [["packages/tools", "workspace-dev@2.0.0"]]
      });
  });
});
