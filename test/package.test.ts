import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("package metadata", () => {
  test("is publishable as the ohrisk CLI package", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as {
      name?: string;
      version?: string;
      private?: boolean;
      license?: string;
      bin?: Record<string, string>;
      publishConfig?: {
        access?: string;
      };
      repository?: {
        url?: string;
      };
    };

    expect(packageJson.name).toBe("ohrisk");
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.bin).toEqual({
      ohrisk: "./src/cli/main.ts"
    });
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.repository?.url).toBe("git+https://github.com/0disoft/ohrisk.git");
  });
});
