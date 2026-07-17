import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readPackageVersion();
const CHECKOUT_ACTION =
  "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0";
const SETUP_NODE_ACTION =
  "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";
const SETUP_BUN_ACTION =
  "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6";

describe("release check workflow", () => {
  test("runs every release gate on Linux, macOS, and Windows", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "ci.yml"),
      "utf8"
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as {
      engines?: { node?: string };
      packageManager?: string;
    };

    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines?.node).toBe(">=24.0.0");
    expect(workflow).toContain("name: Release Check");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("name: Test and pack (${{ matrix.os }})");
    expect(workflow).toContain("runs-on: ${{ matrix.os }}");
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("- ubuntu-latest");
    expect(workflow).toContain("- macos-latest");
    expect(workflow).toContain("- windows-latest");
    expect(workflow).toContain(`uses: ${CHECKOUT_ACTION}`);
    expect(workflow).toContain(`uses: ${SETUP_BUN_ACTION}`);
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain(`uses: ${SETUP_NODE_ACTION}`);
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("run: bun run verify:release");
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d+/);
  });
});

describe("npm publish workflow", () => {
  test("publishes version tags only after the same verification gates", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "publish-npm.yml"),
      "utf8"
    );

    expect(workflow).toContain("name: Publish npm package");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('- "v*"');
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain(`uses: ${CHECKOUT_ACTION}`);
    expect(workflow).toContain(`uses: ${SETUP_NODE_ACTION}`);
    expect(workflow).toContain(`uses: ${SETUP_BUN_ACTION}`);
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("Release tag ${GITHUB_REF_NAME} does not match");
    expect(workflow).toContain("run: bun run verify:release");
    expect(workflow).toContain("already_published=true");
    expect(workflow).toContain("npm publish --access public --provenance");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(workflow).toContain('package_spec="${package_name}@${package_version}"');
    expect(workflow).toContain('npm view "$package_spec" version');
    expect(workflow).toContain('npm view "$package_spec" dist.tarball');
    expect(workflow).toContain('npm view "$package_spec" dist.integrity');
    expect(workflow).not.toContain('npm view "${package_name}" version');
    expect(workflow).not.toContain('npm view "${package_name}" dist.tarball');
    expect(workflow).toContain("CHANGELOG.md does not contain");
    expect(workflow).toContain("gh release create \"$GITHUB_REF_NAME\"");
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d+/);
    expect(workflow).not.toContain("release:");
  });
});

describe("Ohrisk GitHub Action", () => {
  test("uses the bundled CLI by default and permits only exact overrides", () => {
    const actionSource = readFileSync(path.join(repoRoot, "action.yml"), "utf8");
    const cliArgsSource = readFileSync(
      path.join(repoRoot, "src", "cli", "args.ts"),
      "utf8"
    );
    const action = parseYaml(actionSource) as {
      inputs?: Record<string, { default?: string; required?: boolean }>;
      name?: string;
      outputs?: Record<string, { value?: string }>;
      runs?: {
        steps?: Array<{
          id?: string;
          name?: string;
          shell?: string;
          uses?: string;
          with?: Record<string, string>;
        }>;
        using?: string;
      };
    };

    expect(action.name).toBe("Ohrisk");
    expect(action.runs?.using).toBe("composite");
    expect(action.inputs?.version?.default).toBe("bundled");
    expect(action.inputs?.["node-version"]?.default).toBe("24");
    expect(action.inputs?.["setup-node"]?.default).toBe("true");
    expect(action.inputs?.command?.default).toBe("ci");
    expect(action.inputs?.profile?.default).toBe("saas");
    expect(action.inputs?.prod?.default).toBe("true");
    expect(action.inputs?.["fail-on"]?.default).toBe("");
    expect(action.inputs?.["baseline-ref"]?.default).toBe("");
    expect(action.inputs?.archive?.default).toBe("");
    expect(cliArgsSource).toContain('let failOn: RiskSeverity = "high"');
    expect(action.inputs?.all?.default).toBe("false");
    expect(action.inputs?.offline?.default).toBe("false");
    expect(action.inputs?.repo).toBeUndefined();
    expect(action.inputs?.format?.default).toBe("text");
    expect(action.outputs?.["report-path"]?.value).toBe(
      "${{ steps.run.outputs.report-path }}"
    );

    expect(
      action.runs?.steps?.some((step) => step.uses === SETUP_NODE_ACTION)
    ).toBe(true);
    expect(
      action.runs?.steps?.some((step) =>
        step.name === "Verify bundled Ohrisk version" && step.shell === "bash"
      )
    ).toBe(true);
    expect(
      action.runs?.steps?.some((step) => step.id === "run" && step.shell === "bash")
    ).toBe(true);
    expect(actionSource).toContain("${OHRISK_ACTION_PATH}/action-dist/cli.js");
    expect(actionSource).toContain("version must be bundled or an exact semantic version");
    expect(actionSource).toContain("does not match bundled Ohrisk");
    expect(actionSource).toContain(
      'node "${OHRISK_ACTION_PATH}/action-dist/cli.js" "${args[@]}"'
    );
    expect(actionSource).toContain('args+=("diff" "$OHRISK_BASELINE_REF")');
    expect(actionSource).toContain("baseline-ref is required when command=diff");
    expect(actionSource).toContain(
      "baseline-ref must be a git ref, not a CLI option"
    );
    expect(actionSource).toContain(
      "baseline-ref can only be used with command=diff"
    );
    expect(actionSource).toContain(
      "archive is supported only with command=scan or command=ci"
    );
    expect(actionSource).toContain(
      "fail-on can only be used with command=ci or command=diff"
    );
    expect(actionSource).toContain(
      "format must be text, json, or markdown when command=diff"
    );
    expect(actionSource).toContain(
      "no-waivers is not supported when command=diff"
    );
    expect(actionSource).toContain("strict-waivers requires command=ci");
    expect(actionSource).not.toContain("npm install");
    expect(actionSource).not.toContain('version="latest"');
    expect(actionSource).not.toContain("extra-args");
    expect(actionSource).not.toContain("eval ");
  });

  test("forwards bounded archive, multi-lockfile, policy, cache, and registry inputs", () => {
    const actionSource = readFileSync(path.join(repoRoot, "action.yml"), "utf8");

    expect(actionSource).toContain("require_relative_workspace_path");
    expect(actionSource).toContain('[[ "$normalized" == /* || "$normalized" =~ ^[A-Za-z]: ]]');
    expect(actionSource).toContain('"."|./*|*/.|*/./*|*//*|*/)');
    expect(actionSource).toContain("must not contain empty or . path segments");
    expect(actionSource).toContain('if [ "$segment" = ".." ]; then');
    expect(actionSource).toContain(
      'require_relative_workspace_path "lockfile" "$OHRISK_LOCKFILE"'
    );
    expect(actionSource).toContain(
      'require_relative_workspace_file "archive" "$OHRISK_ARCHIVE"'
    );
    expect(actionSource).toContain(
      'require_relative_workspace_path "policy" "$OHRISK_POLICY"'
    );
    expect(actionSource).toContain(
      'require_relative_workspace_path "cache-dir" "$OHRISK_CACHE_DIR"'
    );
    expect(actionSource).toContain(
      'require_relative_workspace_path "output" "$OHRISK_OUTPUT"'
    );
    expect(actionSource).toContain("all=true cannot be combined with lockfile");
    expect(actionSource).toContain("archive cannot be combined with lockfile");
    expect(actionSource).toContain(
      "${name} must stay inside the repository and must not traverse symbolic links"
    );
    expect(actionSource).toContain(
      "${name} must name a repository-relative regular file"
    );
    expect(actionSource).toContain('args+=("--all")');
    expect(actionSource).toContain('args+=("--archive" "$OHRISK_ARCHIVE")');
    expect(actionSource).toContain('args+=("--offline")');
    expect(actionSource).toContain('args+=("--jobs" "$OHRISK_JOBS")');
    expect(actionSource).toContain("OHRISK_ALLOW_HOSTS");
    expect(actionSource).toContain("tr ',' '\\n'");
    expect(actionSource).toContain('args+=("--allow-host" "$host")');
    expect(actionSource).toContain('mkdir -p "$(dirname -- "$OHRISK_OUTPUT")"');
  });

  test("documents tagged, bundled, and offline action usage", () => {
    const docs = readFileSync(path.join(repoRoot, "docs", "ci.md"), "utf8");

    expect(docs).toContain("## Dedicated action");
    expect(docs).toContain(`uses: 0disoft/ohrisk@v${packageVersion}`);
    expect(docs).toContain("contains its own bundled `ohrisk` CLI");
    expect(docs).toContain(`version: ${packageVersion}`);
    expect(docs).toContain("Mutable npm tags");
    expect(docs).toContain("format: html");
    expect(docs).toContain("path: reports/ohrisk.html");
    expect(docs).toContain("command: diff");
    expect(docs).toContain("baseline-ref: origin/main");
    expect(docs).toContain("fetch-depth: 0");
    expect(docs).toContain("caller");
    expect(docs.replace(/\s+/g, " ")).toContain(
      "must be repository-relative paths"
    );
    expect(docs).toContain("ohrisk ci --all --prod --fail-on high");
    expect(docs).toContain("--offline --cache-dir .ohrisk-cache");
    expect(docs).not.toContain("0disoft/ohrisk@main");
    expect(docs).not.toContain("version: latest");
  });
});

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ) as { version?: unknown };

  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must contain a string version.");
  }

  return packageJson.version;
}
