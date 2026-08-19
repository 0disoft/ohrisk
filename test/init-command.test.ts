import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgs } from "../src/cli/args";
import { documentedOptionsFor, supportedOptionsFor } from "../src/cli/command-spec";
import { renderHelp } from "../src/cli/help";
import { main } from "../src/cli/main";
import { OHRISK_VERSION } from "../src/cli/version";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ohrisk init", () => {
  test("parses defaults, options, and command help", () => {
    const defaults = parseArgs(["init"]);
    expect(defaults.ok).toBe(true);
    if (!defaults.ok) throw new Error(defaults.error.message);
    expect(defaults.value).toEqual({
      kind: "init",
      profile: "saas",
      failOn: "high",
      workflow: true,
      waivers: false
    });

    const configured = parseArgs([
      "init",
      "--profile",
      "distributed-app",
      "--fail-on",
      "review",
      "--no-workflow",
      "--waivers"
    ]);
    expect(configured.ok).toBe(true);
    if (!configured.ok) throw new Error(configured.error.message);
    expect(configured.value).toEqual({
      kind: "init",
      profile: "distributed-app",
      failOn: "review",
      workflow: false,
      waivers: true
    });

    const help = parseArgs(["init", "--help"]);
    expect(help.ok).toBe(true);
    if (!help.ok) throw new Error(help.error.message);
    expect(help.value).toEqual({ kind: "help", target: "init" });
    expect(renderHelp("init")).toContain("ohrisk init");
    expect(documentedOptionsFor("init")).toEqual(
      expect.arrayContaining(supportedOptionsFor("init").filter((option) => option !== "-h"))
    );
  });

  test("creates a policy and version-pinned pull-request gate", async () => {
    const project = createProject();
    mkdirSync(path.join(project, ".git"));

    const result = await runInit(project);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
    expect(readFileSync(path.join(project, ".ohrisk.yml"), "utf8")).toContain("version: 1");

    const workflow = readFileSync(
      path.join(project, ".github", "workflows", "ohrisk.yml"),
      "utf8"
    );
    expect(workflow).toContain(`npx --yes ohrisk@${OHRISK_VERSION}`);
    expect(workflow).toContain('diff "${{ github.event.pull_request.base.sha }}"');
    expect(workflow).toContain("--profile saas");
    expect(workflow).toContain("--fail-on high");
    expect(workflow).toContain('working-directory: "."');
    expect(workflow).not.toContain("          --all");
    expect(result.stdout.join("\n")).toContain("created: .ohrisk.yml");

    const repeated = await runInit(project);
    expect(repeated.exitCode).toBe(0);
    expect(repeated.stdout.join("\n")).toContain("unchanged: .ohrisk.yml");
    expect(repeated.stdout.join("\n")).toContain(
      "unchanged: .github/workflows/ohrisk.yml"
    );
  });

  test("writes one repository workflow for a nested project", async () => {
    const repository = temporaryDirectory();
    mkdirSync(path.join(repository, ".git"));
    const project = path.join(repository, "apps", "api");
    mkdirSync(project, { recursive: true });
    writePackageLock(project);

    const result = await runInit(project);
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(project, ".ohrisk.yml"))).toBe(true);
    expect(existsSync(path.join(repository, ".ohrisk.yml"))).toBe(false);

    const workflow = readFileSync(
      path.join(repository, ".github", "workflows", "ohrisk.yml"),
      "utf8"
    );
    expect(workflow).toContain('working-directory: "apps/api"');
    expect(result.stdout.join("\n")).toContain("project: apps/api");
  });

  test("uses --all when the selected root contains multiple dependency inputs", async () => {
    const project = createProject();
    mkdirSync(path.join(project, ".git"));
    writeFileSync(path.join(project, "Cargo.lock"), "", "utf8");

    const result = await runInit(project);
    expect(result.exitCode).toBe(0);
    const workflow = readFileSync(
      path.join(project, ".github", "workflows", "ohrisk.yml"),
      "utf8"
    );
    expect(workflow).toContain("          --all");
    expect(result.stdout.join("\n")).toContain("Cargo.lock, package-lock.json");
  });

  test("supports local-only setup with an empty waiver template", async () => {
    const project = createProject();
    const result = await runInit(project, ["--waivers", "--no-workflow"]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(project, ".github"))).toBe(false);
    expect(JSON.parse(
      readFileSync(path.join(project, ".ohrisk-waivers.json"), "utf8")
    )).toEqual({ waivers: [] });
  });

  test("preserves user-owned policy and workflow files", async () => {
    const project = createProject();
    mkdirSync(path.join(project, ".git"));
    mkdirSync(path.join(project, ".github", "workflows"), { recursive: true });
    writeFileSync(path.join(project, ".ohrisk.yml"), "version: 1\nlicenses: {}\n", "utf8");
    writeFileSync(
      path.join(project, ".github", "workflows", "ohrisk.yml"),
      "name: Custom license process\n",
      "utf8"
    );

    const result = await runInit(project);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(project, ".ohrisk.yml"), "utf8")).toBe(
      "version: 1\nlicenses: {}\n"
    );
    expect(readFileSync(
      path.join(project, ".github", "workflows", "ohrisk.yml"),
      "utf8"
    )).toBe("name: Custom license process\n");
    expect(result.stdout.join("\n")).toContain("preserved: .ohrisk.yml");
    expect(result.stdout.join("\n")).toContain(
      "preserved: .github/workflows/ohrisk.yml"
    );
  });

  test("rejects a project path that could inject a workflow expression", async () => {
    const repository = temporaryDirectory();
    mkdirSync(path.join(repository, ".git"));
    const project = path.join(repository, "apps", "${{ github.token }}");
    mkdirSync(project, { recursive: true });
    writePackageLock(project);

    const result = await runInit(project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("INIT_WRITE_FAILED");
    expect(result.stderr.join("\n")).toContain("embedded safely");
    expect(existsSync(path.join(project, ".ohrisk.yml"))).toBe(false);
  });

  test("rejects a symbolic-link workflow parent before writing any file", async () => {
    if (process.platform === "win32") {
      return;
    }

    const project = createProject();
    mkdirSync(path.join(project, ".git"));
    mkdirSync(path.join(project, ".github"));
    const outside = temporaryDirectory();
    symlinkSync(outside, path.join(project, ".github", "workflows"), "dir");

    const result = await runInit(project);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("INIT_WRITE_FAILED");
    expect(result.stderr.join("\n")).toContain("symbolic link");
    expect(existsSync(path.join(project, ".ohrisk.yml"))).toBe(false);
  });
});

function createProject(): string {
  const project = temporaryDirectory();
  writePackageLock(project);
  return project;
}

function writePackageLock(project: string): void {
  writeFileSync(
    path.join(project, "package-lock.json"),
    JSON.stringify({
      name: "init-fixture",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "init-fixture"
        }
      }
    }, null, 2),
    "utf8"
  );
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ohrisk-init-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runInit(
  cwd: string,
  options: string[] = []
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await main(["init", ...options], {
    cwd,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  });
  return { exitCode, stdout, stderr };
}
