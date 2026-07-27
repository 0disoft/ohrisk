import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "bun:test";

import { parseZigHash } from "../src/graph/zig-zon";

test("Zig conformance reference > keeps the pinned Zig 0.16.0 hash identity parseable", () => {
  const fixturePath = path.join(import.meta.dir, "fixtures", "zig-conformance.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    schemaVersion: number;
    zigVersion: string;
    packageName: string;
    packageVersion: string;
    fingerprint: string;
    paths: string[];
    hash: string;
  };

  equal(fixture.schemaVersion, 1);
  equal(fixture.zigVersion, "0.16.0");
  equal(fixture.fingerprint, "0x3d99ed0612345678");
  deepEqual(fixture.paths, ["build.zig", "build.zig.zon", "LICENSE", "src"]);

  const parsed = parseZigHash(fixture.hash);
  equal(parsed?.format, "new");
  if (parsed?.format !== "new") {
    throw new Error("Expected the Zig conformance reference to use a new-format hash.");
  }
  equal(parsed.name, fixture.packageName);
  equal(parsed.version, fixture.packageVersion);
});
