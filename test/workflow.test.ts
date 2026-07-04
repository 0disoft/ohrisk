import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readPackageVersion();

describe("release check workflow", () => {
  test("runs the release-relevant local gates", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "ci.yml"),
      "utf8"
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as {
      engines?: {
        node?: string;
      };
      packageManager?: string;
    };

    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines?.node).toBe(">=24.0.0");
    expect(workflow).toContain("name: Release Check");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("name: Test and pack (${{ matrix.os }})");
    expect(workflow).toContain("runs-on: ${{ matrix.os }}");
    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("- ubuntu-latest");
    expect(workflow).toContain("- windows-latest");
    expect(workflow).toContain("uses: actions/checkout@v7");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("node --version");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("run: bun run verify:release");
  });
});

describe("npm publish workflow", () => {
  test("publishes version tags after release verification", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "publish-npm.yml"),
      "utf8"
    );

    expect(workflow).toContain("name: Publish npm package");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('- "v*"');
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("uses: actions/checkout@v7");
    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("Release tag ${GITHUB_REF_NAME} does not match");
    expect(workflow).toContain("run: bun run verify:release");
    expect(workflow).toContain("already_published=true");
    expect(workflow).toContain("npm publish --access public --provenance");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(workflow).toContain("npm view \"${package_name}\" dist.tarball");
    expect(workflow).toContain("CHANGELOG.md does not contain");
    expect(workflow).toContain("gh release create \"$GITHUB_REF_NAME\"");
    expect(workflow).not.toContain("release:");
  });
});

describe("Ohrisk GitHub Action", () => {
  test("provides a bounded composite action contract", () => {
    const actionSource = readFileSync(path.join(repoRoot, "action.yml"), "utf8");
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
    expect(action.inputs?.version?.default).toBe("");
    expect(action.inputs?.["node-version"]?.default).toBe("24");
    expect(action.inputs?.["setup-node"]?.default).toBe("true");
    expect(action.inputs?.command?.default).toBe("ci");
    expect(action.inputs?.profile?.default).toBe("saas");
    expect(action.inputs?.prod?.default).toBe("true");
    expect(action.inputs?.["fail-on"]?.default).toBe("high");
    expect(action.inputs?.format?.default).toBe("text");
    expect(action.outputs?.["report-path"]?.value).toBe("${{ steps.run.outputs.report-path }}");

    expect(action.runs?.steps?.some((step) => step.uses === "actions/setup-node@v6")).toBe(true);
    expect(action.runs?.steps?.some((step) => step.id === "run" && step.shell === "bash")).toBe(true);
    expect(actionSource).toContain("OHRISK_ACTION_REF: ${{ github.action_ref }}");
    expect(actionSource).toContain("require_ohrisk_version");
    expect(actionSource).toContain("version must be latest or a semantic version");
    expect(actionSource).toContain('[[ "$value" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]');
    expect(actionSource).toContain('case "$OHRISK_ACTION_REF" in');
    expect(actionSource).toContain('version="${OHRISK_ACTION_REF#v}"');
    expect(actionSource).toContain('*) version="latest" ;;');
    expect(actionSource).toContain('require_ohrisk_version "$version"');
    expect(actionSource).toContain('v*) version="${version#v}" ;;');
    expect(actionSource).toContain('npm install -g "ohrisk@${version}"');
    expect(actionSource).toContain("args=()");
    expect(actionSource).toContain('ohrisk "${args[@]}"');
    expect(actionSource).not.toContain("extra-args");
  });

  test("validates action report paths before writing outputs", () => {
    const actionSource = readFileSync(path.join(repoRoot, "action.yml"), "utf8");

    expect(actionSource).toContain("require_relative_workspace_path");
    expect(actionSource).toContain('[[ "$normalized" == /* || "$normalized" =~ ^[A-Za-z]: ]]');
    expect(actionSource).toContain('"."|./*|*/.|*/./*|*//*|*/)');
    expect(actionSource).toContain("must not contain empty or . path segments");
    expect(actionSource).toContain('if [ "$segment" = ".." ]; then');
    expect(actionSource).toContain('require_relative_workspace_path "lockfile" "$OHRISK_LOCKFILE"');
    expect(actionSource).toContain('require_relative_workspace_path "output" "$OHRISK_OUTPUT"');
    expect(actionSource).toContain('mkdir -p "$(dirname -- "$OHRISK_OUTPUT")"');
  });

  test("documents the dedicated action examples", () => {
    const docs = readFileSync(path.join(repoRoot, "docs", "ci.md"), "utf8");

    expect(docs).toContain("## Dedicated action");
    expect(docs).toContain("uses: 0disoft/ohrisk@main");
    expect(docs).toContain("track the latest action wiring and latest npm package");
    expect(docs).toContain(`0disoft/ohrisk@v${packageVersion}`);
    expect(docs).toContain(`\`ohrisk@${packageVersion}\` by default`);
    expect(docs).toContain("Only `latest` and semantic versions such as");
    expect(docs).toContain("version: latest");
    expect(docs).toContain("format: html");
    expect(docs).toContain("path: reports/ohrisk.html");
    expect(docs).toContain("must be repository-relative paths");
    expect(docs).toContain("empty path segments");
    expect(docs).toContain("`.` segments");
    expect(docs).not.toContain("does not provide a dedicated GitHub Action");
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
