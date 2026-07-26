import { test } from "bun:test";
import { equal } from "node:assert";

import { parseZigZonText, parseZigHash } from "../src/graph/zig-zon";

test("parseZigZonText > parses dependencies with URL and hash", () => {
  const input = `.{
    .name = .zls,
    .version = "0.17.0-dev",
    .minimum_zig_version = "0.17.0-dev.292+fc1c83a36",
    .dependencies = .{
        .known_folders = .{
            .url = "https://github.com/ziglibs/known-folders/archive/207c34a16e4365edc20d92c7892f962b3bed46e8.tar.gz",
            .hash = "known_folders-0.0.0-Fy-PJsbKAACbDh9bBxR0MMThxZSS6A9RH4apWphNHY70",
        },
        .diffz = .{
            .url = "https://github.com/ziglibs/diffz/archive/d080c1eb782fff15068cabb3b82da85ce6054b74.tar.gz",
            .hash = "diffz-0.0.1-G2tlIfLNAQCc06RFk0tFGj2M-X-id4WHFkMVw2JoMILR",
        },
    },
    .paths = .{""},
    .fingerprint = 0xa66330b97eb969ae,
}`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.rootName, "zls");
  equal(result.value.nodes.length, 2);

  const diffz = result.value.nodes[0]!;
  equal(diffz.name, "diffz");
  equal(diffz.ecosystem, "zig");
  equal(diffz.resolved, "https://github.com/ziglibs/diffz/archive/d080c1eb782fff15068cabb3b82da85ce6054b74.tar.gz");
  equal(diffz.integrity, "diffz-0.0.1-G2tlIfLNAQCc06RFk0tFGj2M-X-id4WHFkMVw2JoMILR");
  equal(diffz.direct, true);
  equal(diffz.dependencyType, "production");

  const known = result.value.nodes[1]!;
  equal(known.name, "known_folders");
  equal(known.resolved, "https://github.com/ziglibs/known-folders/archive/207c34a16e4365edc20d92c7892f962b3bed46e8.tar.gz");
  equal(known.integrity, "known_folders-0.0.0-Fy-PJsbKAACbDh9bBxR0MMThxZSS6A9RH4apWphNHY70");
});

test("parseZigZonText > parses path dependencies", () => {
  const input = `.{
    .name = .myproject,
    .version = "0.1.0",
    .dependencies = .{
        .local_lib = .{
            .path = "libs/local_lib",
        },
    },
}`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.nodes.length, 1);
  const dep = result.value.nodes[0]!;
  equal(dep.name, "local_lib");
  equal(dep.resolved, undefined);
  equal(dep.version, "libs/local_lib");
  equal(dep.integrity, undefined);
});

test("parseZigZonText > parses lazy dependencies", () => {
  const input = `.{
    .name = .app,
    .version = "1.0.0",
    .dependencies = .{
        .tracy = .{
            .url = "https://github.com/wolfpld/tracy/archive/refs/tags/v0.13.1.tar.gz",
            .hash = "N-V-__8AAOncKwEm1F9c5LrT7HMNmRMYX8-fAoqpc6YyTu9X",
            .lazy = true,
        },
    },
}`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.nodes.length, 1);
  const dep = result.value.nodes[0]!;
  equal(dep.name, "tracy");
  equal(dep.integrity, "N-V-__8AAOncKwEm1F9c5LrT7HMNmRMYX8-fAoqpc6YyTu9X");
});

test("parseZigZonText > handles empty dependencies", () => {
  const input = `.{
    .name = .empty,
    .version = "0.0.0",
    .dependencies = .{},
}`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.nodes.length, 0);
  equal(result.value.rootName, "empty");
});

test("parseZigZonText > reports malformed ZON as typed errors", () => {
  const result = parseZigZonText("not valid zon", "build.zig.zon");
  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
});

test("parseZigZonText > handles comments", () => {
  const input = `.{
    // This is a comment
    .name = .commented,
    .version = "1.0.0",
    .dependencies = .{
        // Another comment
        .foo = .{
            .url = "https://example.com/foo.tar.gz",
            .hash = "foo-1.0.0-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
    },
}`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.rootName, "commented");
  equal(result.value.nodes.length, 1);
});

test("parseZigZonText > extracts version from URL archive hash", () => {
  const input = `.{
    .name = .test,
    .version = "0.0.0",
    .dependencies = .{
        .dep = .{
            .url = "https://github.com/ziglibs/dep/archive/abc1234.tar.gz",
            .hash = "dep-0.0.0-Fy-PJsbKAACbDh9bBxR0MMThxZSS6A9RH4apWphNHY70",
        },
    },
}`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  const dep = result.value.nodes[0]!;
  equal(dep.version, "0.0.0");
});

test("parseZigHash > parses old multihash format", () => {
  const result = parseZigHash("1220138f4aba0c01e66b68ed9e1e1e74614c06e4743d88bc58af4f1c3dd0aae5fea7");
  equal(result?.format, "old");
  if (result?.format !== "old") return;
  equal(result.digestHex, "138f4aba0c01e66b68ed9e1e1e74614c06e4743d88bc58af4f1c3dd0aae5fea7");
});

test("parseZigHash > parses new name-version-hashplus format", () => {
  const result = parseZigHash("known_folders-0.0.0-Fy-PJsbKAACbDh9bBxR0MMThxZSS6A9RH4apWphNHY70");
  equal(result?.format, "new");
  if (result?.format !== "new") return;
  equal(result.name, "known_folders");
  equal(result.version, "0.0.0");
  equal(result.hashPlus, "Fy-PJsbKAACbDh9bBxR0MMThxZSS6A9RH4apWphNHY70");
});

test("parseZigHash > returns null for invalid hash", () => {
  equal(parseZigHash("invalid"), null);
  equal(parseZigHash(""), null);
});
