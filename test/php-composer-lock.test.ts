import { describe, expect, test } from "bun:test";

import { parseComposerLockText } from "../src/graph/php-composer-lock";

describe("parseComposerLockText", () => {
  test("parses Composer production, development, and transitive dependencies", () => {
    const composerLock = JSON.stringify({
      packages: [
        {
          name: "vendor/app-lib",
          version: "1.0.0",
          require: {
            "php": ">=8.2",
            "vendor/transitive-lib": "^2.0"
          }
        },
        {
          name: "vendor/transitive-lib",
          version: "2.0.0"
        }
      ],
      "packages-dev": [
        {
          name: "vendor/dev-tool",
          version: "3.0.0"
        }
      ]
    });
    const composerJson = JSON.stringify({
      name: "vendor/root",
      require: {
        "vendor/app-lib": "^1.0"
      },
      "require-dev": {
        "vendor/dev-tool": "^3.0"
      }
    });

    const result = parseComposerLockText(composerLock, "fixture-php/composer.lock", {
      composerJsonText: composerJson
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("vendor/root");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "vendor/app-lib@1.0.0",
      "vendor/dev-tool@3.0.0",
      "vendor/transitive-lib@2.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "vendor/app-lib@1.0.0"))
      .toMatchObject({
        ecosystem: "composer",
        dependencyType: "production",
        direct: true
      });
    expect(result.value.nodes.find((node) => node.id === "vendor/dev-tool@3.0.0"))
      .toMatchObject({
        ecosystem: "composer",
        dependencyType: "development",
        direct: true
      });
    expect(result.value.nodes.find((node) => node.id === "vendor/transitive-lib@2.0.0"))
      .toMatchObject({
        ecosystem: "composer",
        dependencyType: "production",
        direct: false,
        paths: [["vendor/root", "vendor/app-lib@1.0.0", "vendor/transitive-lib@2.0.0"]]
      });
  });

  test("reports malformed composer.lock package entries as typed errors", () => {
    const result = parseComposerLockText(
      JSON.stringify({
        packages: {}
      }),
      "composer.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed composer.lock to fail.");
    }

    expect(result.error.code).toBe("COMPOSER_LOCK_PARSE_FAILED");
  });
});
