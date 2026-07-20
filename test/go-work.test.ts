import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseGoWorkFile } from "../src/graph/go-work";

describe("parseGoWorkFile", () => {
  test("parses current requirements from every workspace module", () => {
    const projectRoot = mkdtempSync("ohrisk-go-work-");

    try {
      writeGoWorkspace(projectRoot, {
        goWork: [
          "go 1.22",
          "",
          "use (",
          "  ./app",
          "  ./worker",
          ")"
        ].join("\n"),
        modules: {
          app: {
            goMod: [
              "module example.com/app",
              "",
              "go 1.22",
              "",
              "require github.com/acme/risk v1.0.0"
            ].join("\n")
          },
          worker: {
            goMod: [
              "module example.com/worker",
              "",
              "go 1.22",
              "",
              "require github.com/acme/ok v0.2.0"
            ].join("\n"),
            goSum: [
              `github.com/acme/ok v0.2.0 h1:${"A".repeat(43)}=`,
              `github.com/acme/transitive v0.1.0 h1:${"B".repeat(43)}=`
            ].join("\n")
          }
        }
      });

      const result = parseGoWorkFile(path.join(projectRoot, "go.work"));

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.lockfilePath).toBe(path.join(projectRoot, "go.work"));
      expect(result.value.nodes.map((node) => node.id)).toEqual([
        "github.com/acme/ok@v0.2.0",
        "github.com/acme/risk@v1.0.0"
      ]);
      expect(result.value.nodes.find((node) => node.id === "github.com/acme/risk@v1.0.0"))
        .toMatchObject({
          direct: true,
          paths: [[path.basename(projectRoot), "example.com/app", "github.com/acme/risk@v1.0.0"]]
        });
      expect(result.value.nodes.find((node) => node.id === "github.com/acme/ok@v0.2.0"))
        .toMatchObject({
          integrity: `h1:${"A".repeat(43)}=`,
          direct: true,
          paths: [[path.basename(projectRoot), "example.com/worker", "github.com/acme/ok@v0.2.0"]]
        });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("deduplicates repeated go.work use paths for the same module", () => {
    const projectRoot = mkdtempSync("ohrisk-go-work-duplicate-use-");

    try {
      writeGoWorkspace(projectRoot, {
        goWork: [
          "go 1.22",
          "",
          "use (",
          "  ./app",
          "  ./app",
          ")"
        ].join("\n"),
        modules: {
          app: {
            goMod: [
              "module example.com/app",
              "",
              "go 1.22",
              "",
              "require github.com/acme/risk v1.0.0"
            ].join("\n")
          }
        }
      });

      const result = parseGoWorkFile(path.join(projectRoot, "go.work"));

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.nodes).toHaveLength(1);
      expect(result.value.nodes[0]).toMatchObject({
        id: "github.com/acme/risk@v1.0.0",
        paths: [[path.basename(projectRoot), "example.com/app", "github.com/acme/risk@v1.0.0"]]
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("lets go.work wildcard replace override module-specific go.mod replace directives", () => {
    const projectRoot = mkdtempSync("ohrisk-go-work-replace-");

    try {
      writeGoWorkspace(projectRoot, {
        goWork: [
          "go 1.22",
          "",
          "use ./app",
          "",
          "replace github.com/acme/risk => github.com/acme/workspace-fork v1.0.9"
        ].join("\n"),
        modules: {
          app: {
            goMod: [
              "module example.com/app",
              "",
              "go 1.22",
              "",
              "require github.com/acme/risk v1.0.0",
              "replace github.com/acme/risk v1.0.0 => github.com/acme/module-fork v1.0.1"
            ].join("\n")
          }
        }
      });

      const result = parseGoWorkFile(path.join(projectRoot, "go.work"));

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.nodes).toHaveLength(1);
      expect(result.value.nodes[0]).toMatchObject({
        id: "github.com/acme/risk@v1.0.0",
        resolved: "go-module:github.com/acme/workspace-fork@v1.0.9"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects workspace modules outside the project root", () => {
    const parent = mkdtempSync("ohrisk-go-work-outside-");
    const projectRoot = path.join(parent, "repo");
    const outsideRoot = path.join(parent, "outside");

    try {
      mkdirSync(projectRoot, { recursive: true });
      mkdirSync(outsideRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "go.work"),
        [
          "go 1.22",
          "",
          "use ../outside"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(outsideRoot, "go.mod"),
        [
          "module example.com/outside",
          "",
          "go 1.22"
        ].join("\n"),
        "utf8"
      );

      const result = parseGoWorkFile(path.join(projectRoot, "go.work"));

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected outside go.work use path to fail.");
      }
      expect(result.error.code).toBe("GO_WORK_PARSE_FAILED");
      expect(result.error.message).toContain("Workspace module paths must stay inside the project root.");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("rejects conflicting replace targets declared in go.work", () => {
    const projectRoot = mkdtempSync("ohrisk-go-work-conflict-");

    try {
      writeGoWorkspace(projectRoot, {
        goWork: [
          "go 1.22",
          "",
          "use ./app",
          "",
          "replace (",
          "  github.com/acme/risk => github.com/acme/fork-a v1.0.1",
          "  github.com/acme/risk => github.com/acme/fork-b v1.0.2",
          ")"
        ].join("\n"),
        modules: {
          app: {
            goMod: [
              "module example.com/app",
              "",
              "go 1.22",
              "",
              "require github.com/acme/risk v1.0.0"
            ].join("\n")
          }
        }
      });

      const result = parseGoWorkFile(path.join(projectRoot, "go.work"));

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected conflicting go.work replace directives to fail.");
      }
      expect(result.error.code).toBe("GO_WORK_PARSE_FAILED");
      expect(result.error.message).toContain("Workspace replace directives contain conflicting targets.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function mkdtempSync(prefix: string): string {
  return path.join(tmpdir(), `${prefix}${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function writeGoWorkspace(inputRoot: string, input: {
  goWork: string;
  modules: Record<string, { goMod: string; goSum?: string }>;
}): void {
  mkdirSync(inputRoot, { recursive: true });
  writeFileSync(path.join(inputRoot, "go.work"), input.goWork, "utf8");

  for (const [moduleDir, files] of Object.entries(input.modules)) {
    const absoluteModuleDir = path.join(inputRoot, moduleDir);
    mkdirSync(absoluteModuleDir, { recursive: true });
    writeFileSync(path.join(absoluteModuleDir, "go.mod"), files.goMod, "utf8");
    if (files.goSum) {
      writeFileSync(path.join(absoluteModuleDir, "go.sum"), files.goSum, "utf8");
    }
  }
}
