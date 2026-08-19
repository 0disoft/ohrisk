import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const actionSource = readFileSync(path.join(repoRoot, "action.yml"), "utf8");
const action = parseYaml(actionSource) as CompositeAction;
const CACHE_ACTION_SHA = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9";
const CACHE_RESTORE_ACTION = `actions/cache/restore@${CACHE_ACTION_SHA}`;
const CACHE_SAVE_ACTION = `actions/cache/save@${CACHE_ACTION_SHA}`;

type ActionInput = {
  default?: string;
  description?: string;
};

type ActionOutput = {
  description?: string;
  value?: string;
};

type ActionStep = {
  "continue-on-error"?: boolean;
  env?: Record<string, string>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  shell?: string;
  uses?: string;
  with?: Record<string, string>;
};

type CompositeAction = {
  inputs?: Record<string, ActionInput>;
  outputs?: Record<string, ActionOutput>;
  runs?: {
    steps?: ActionStep[];
    using?: string;
  };
};

type CacheSettingsInvocation = {
  archive?: string;
  cache: string;
  cacheDir: string;
  cwd: string;
};

type CacheSettingsResult = {
  outputs: Record<string, string>;
  status: number;
  stderr: string;
  stdout: string;
};

describe("Ohrisk Action persistent artifact cache", () => {
  test("pins restore and save actions and exposes the exact cache-hit result", () => {
    const settings = actionStep("cache-settings");
    const restore = actionStep("artifact-cache");
    const run = actionStep("run");
    const save = actionStep("artifact-cache-save");

    expect(action.inputs?.cache?.default).toBe("false");
    expect(action.inputs?.cache?.description).toContain("actions/cache");
    expect(action.outputs?.["cache-hit"]?.value).toBe(
      "${{ steps.artifact-cache.outputs.cache-hit }}"
    );

    expect(settings.shell).toBe("bash");
    expect(settings.env?.OHRISK_CACHE_DIR).toBe("${{ inputs.cache-dir }}");
    expect(settings.env?.OHRISK_PERSIST_CACHE).toBe("${{ inputs.cache }}");
    expect(settings.run).toContain('effective_cache_dir=".ohrisk-cache"');
    expect(settings.run).toContain("cache must be true or false");
    expect(settings.run).toContain("hashFiles(");
    expect(settings.run).toContain("ohrisk-artifacts-v1-");
    expect(settings.run).toContain("createReadStream");
    expect(settings.run).toContain(".ohrisk-artifact-cache");

    expect(restore.uses).toBe(CACHE_RESTORE_ACTION);
    expect(restore.if).toBe("${{ inputs.cache == 'true' }}");
    expect(restore["continue-on-error"]).toBe(true);
    expect(restore.with?.path).toBe(
      "${{ github.workspace }}/${{ steps.cache-settings.outputs.cache-dir }}"
    );
    expect(restore.with?.key).toBe("${{ steps.cache-settings.outputs.cache-key }}");
    expect(restore.with?.["restore-keys"]).toContain(
      "ohrisk-artifacts-v1-${{ runner.os }}-${{ runner.arch }}-"
    );

    expect(run.env?.OHRISK_CACHE_DIR).toBe(
      "${{ steps.cache-settings.outputs.cache-dir }}"
    );
    expect(run.run).toContain(
      'require_relative_workspace_no_symlinks "cache-dir" "$OHRISK_CACHE_DIR"'
    );

    expect(save.uses).toBe(CACHE_SAVE_ACTION);
    expect(save["continue-on-error"]).toBe(true);
    expect(save.if).toContain("!cancelled()");
    expect(save.if).toContain("steps.cache-settings.outcome == 'success'");
    expect(save.if).toContain("steps.run.outcome == 'success'");
    expect(save.if).toContain("steps.run.outcome == 'failure'");
    expect(save.if).toContain("steps.artifact-cache.outputs.cache-hit != 'true'");
    expect(save.with?.key).toBe(
      "${{ steps.cache-settings.outputs.cache-key }}"
    );

    expect(actionSource).not.toContain("actions/cache/restore@v6");
    expect(actionSource).not.toContain("actions/cache/save@v6");
  });

  test("defaults persistent caching to a contained path without changing cache-dir-only use", () => {
    withWorkspace((workspace) => {
      const persistent = invokeCacheSettings({
        cache: "true",
        cacheDir: "",
        cwd: workspace
      });
      expect(persistent.status).toBe(0);
      expect(persistent.outputs["cache-dir"]).toBe(".ohrisk-cache");
      expect(persistent.outputs["cache-key"]).toBe(
        "ohrisk-artifacts-v1-Linux-X64-test-dependency-digest-no-archive"
      );

      const localOnly = invokeCacheSettings({
        cache: "false",
        cacheDir: "ci/ohrisk-cache",
        cwd: workspace
      });
      expect(localOnly.status).toBe(0);
      expect(localOnly.outputs["cache-dir"]).toBe("ci/ohrisk-cache");
      expect(localOnly.outputs["cache-key"]).toBeUndefined();

      const disabled = invokeCacheSettings({
        cache: "false",
        cacheDir: "",
        cwd: workspace
      });
      expect(disabled.status).toBe(0);
      expect(disabled.outputs).toEqual({});
    });
  });

  test("rejects invalid cache booleans and unsafe cache paths before restore", () => {
    withWorkspace((workspace) => {
      const invalidBoolean = invokeCacheSettings({
        cache: "yes",
        cacheDir: "",
        cwd: workspace
      });
      expect(invalidBoolean.status).not.toBe(0);
      expect(invalidBoolean.stdout).toContain("cache must be true or false");

      const traversal = invokeCacheSettings({
        cache: "true",
        cacheDir: "../shared-cache",
        cwd: workspace
      });
      expect(traversal.status).not.toBe(0);
      expect(traversal.stdout).toContain(
        "cache-dir must not contain .. path segments"
      );

      const absolute = invokeCacheSettings({
        cache: "true",
        cacheDir: "/tmp/ohrisk-cache",
        cwd: workspace
      });
      expect(absolute.status).not.toBe(0);
      expect(absolute.stdout).toContain(
        "cache-dir must be a repository-relative path"
      );
    });
  });

  test("refuses to restore over non-cache data but accepts an owned cache", () => {
    withWorkspace((workspace) => {
      const cacheDir = path.join(workspace, "existing-cache");
      mkdirSync(cacheDir);
      writeFileSync(path.join(cacheDir, "important.txt"), "do not overwrite");

      const unowned = invokeCacheSettings({
        cache: "true",
        cacheDir: "existing-cache",
        cwd: workspace
      });
      expect(unowned.status).not.toBe(0);
      expect(unowned.stdout).toContain(
        "does not contain the Ohrisk ownership marker"
      );

      writeFileSync(
        path.join(cacheDir, ".ohrisk-artifact-cache"),
        "ohrisk artifact cache v3\n"
      );
      const owned = invokeCacheSettings({
        cache: "true",
        cacheDir: "existing-cache",
        cwd: workspace
      });
      expect(owned.status).toBe(0);
      expect(owned.outputs["cache-dir"]).toBe("existing-cache");
    });
  });

  test("includes an exact archive digest in the primary cache key", () => {
    withWorkspace((workspace) => {
      const archiveDirectory = path.join(workspace, "artifacts");
      mkdirSync(archiveDirectory);
      const archiveBytes = Buffer.from("bounded archive fixture");
      const archivePath = path.join(archiveDirectory, "source.tar.gz");
      writeFileSync(archivePath, archiveBytes);

      const result = invokeCacheSettings({
        archive: "artifacts/source.tar.gz",
        cache: "true",
        cacheDir: "",
        cwd: workspace
      });
      expect(result.status).toBe(0);
      const expectedDigest = createHash("sha256").update(archiveBytes).digest("hex");
      expect(result.outputs["cache-key"]).toBe(
        `ohrisk-artifacts-v1-Linux-X64-test-dependency-digest-${expectedDigest}`
      );
    });
  });

  test("documents opt-in persistence, the default path, and cache-hit semantics", () => {
    const inputs = readFileSync(
      path.join(repoRoot, "docs", "github-action", "inputs-and-outputs.md"),
      "utf8"
    );
    const contract = readFileSync(
      path.join(repoRoot, "docs", "github-action", "action-contract.md"),
      "utf8"
    );
    const ciGuide = readFileSync(path.join(repoRoot, "docs", "ci.md"), "utf8");
    const actionGuide = readFileSync(
      path.join(repoRoot, "docs", "github-actions.md"),
      "utf8"
    );

    expect(inputs).toContain("`cache`");
    expect(inputs).toContain("`cache-hit`");
    expect(contract).toContain("actions/cache/restore");
    expect(contract).toContain("actions/cache/save");
    expect(contract).toContain("failed risk gate");
    expect(ciGuide).toContain('cache: "true"');
    expect(ciGuide).toContain(".ohrisk-cache");
    expect(actionGuide).toContain('cache: "true"');
    expect(actionGuide).toContain("cache-hit");
  });
});

function actionStep(id: string): ActionStep {
  const step = action.runs?.steps?.find((candidate) => candidate.id === id);
  if (!step) {
    throw new Error(`Action step ${id} is missing.`);
  }
  return step;
}

function invokeCacheSettings(input: CacheSettingsInvocation): CacheSettingsResult {
  const settings = actionStep("cache-settings");
  if (!settings.run) {
    throw new Error("Cache settings step has no shell source.");
  }

  const outputDirectory = mkdtempSync(path.join(input.cwd, ".cache-settings-"));
  const outputPath = path.join(outputDirectory, "github-output.txt");
  const renderedScript = settings.run
    .replace(
      /\$\{\{\s*hashFiles\([\s\S]*?\)\s*\}\}/g,
      "test-dependency-digest"
    )
    .replaceAll("${{ runner.os }}", "Linux")
    .replaceAll("${{ runner.arch }}", "X64");

  const result = spawnSync("bash", ["-c", renderedScript], {
    cwd: input.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      OHRISK_ARCHIVE: input.archive ?? "",
      OHRISK_CACHE_DIR: input.cacheDir,
      OHRISK_PERSIST_CACHE: input.cache
    }
  });

  return {
    outputs: readGitHubOutputs(outputPath),
    status: result.status ?? 1,
    stderr: result.stderr,
    stdout: result.stdout
  };
}

function readGitHubOutputs(outputPath: string): Record<string, string> {
  if (!existsSync(outputPath)) {
    return {};
  }

  const outputs: Record<string, string> = {};
  for (const line of readFileSync(outputPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    outputs[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return outputs;
}

function withWorkspace(run: (workspace: string) => void): void {
  const workspace = mkdtempSync(path.join(tmpdir(), "ohrisk-action-cache-"));
  try {
    run(workspace);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}
