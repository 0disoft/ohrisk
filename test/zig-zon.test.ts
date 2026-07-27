import { test } from "bun:test";
import { equal } from "node:assert";

import {
  extractZigManifestMetadata,
  parseZigZonText,
  parseZigHash
} from "../src/graph/zig-zon";

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

test("parseZigZonText > preserves Zig's last-field-wins manifest semantics", () => {
  const input = `.{
    .name = .myproject,
    .version = "0.0.1",
    .version = "0.1.0",
    .dependencies = .{
      .local_lib = .{ .path = "libs/old" },
      .local_lib = .{ .path = "libs/current" },
    },
  }`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.nodes[0]?.version, "libs/current");
  equal(extractZigManifestMetadata(input)?.version, "0.1.0");
});

test("parseZigZonText > validates every duplicate root field occurrence", () => {
  const manifests = [
    `.{ .name = true, .name = .app, .version = "1.0.0", .dependencies = .{} }`,
    `.{ .name = .app, .version = true, .version = "1.0.0", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .fingerprint = "bad", .fingerprint = 0x0, .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .minimum_zig_version = true, .minimum_zig_version = "0.16.0", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .dependencies = "bad", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .paths = "bad", .paths = .{ "" }, .dependencies = .{} }`
  ];

  for (const manifest of manifests) {
    const result = parseZigZonText(manifest, "build.zig.zon");
    equal(result.ok, false);
  }
});

test("parseZigZonText > rejects non-bare root names", () => {
  for (const nameValue of ['"app"', '.@"app"', '.@"if"', '.@"foo-bar"']) {
    const input = `.{
      .name = ${nameValue},
      .version = "1.0.0",
      .dependencies = .{},
    }`;

    const result = parseZigZonText(input, "build.zig.zon");
    equal(result.ok, false);
    equal(extractZigManifestMetadata(input), undefined);
  }
});

test("parseZigZonText > rejects dependency identifiers that Zig cannot tokenize", () => {
  for (const dependencyName of ["123", "if", "const", "while"]) {
    const input = `.{
      .name = .app,
      .version = "1.0.0",
      .dependencies = .{
        .${dependencyName} = .{ .url = "https://example.com/dep.tar.gz", .hash = "1220aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      },
    }`;

    const result = parseZigZonText(input, "build.zig.zon");
    equal(result.ok, false);
  }
});

test("parseZigZonText > accepts Zig quoted identifiers", () => {
  const input = `.{
    .@"name" = .app,
    .@"version" = "1.0.0",
    .@"dependencies" = .{
      .@"if" = .{ .@"path" = "vendor/if" },
      .@"123" = .{ .@"path" = "vendor/123" },
      .@"foo-bar" = .{ .@"path" = "vendor/foo-bar" },
      .@"" = .{ .@"path" = "vendor/empty" },
      .@"\\x80" = .{ .@"path" = "vendor/non-utf8" },
    },
  }`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.rootName, "app");
  const names = result.value.nodes.map((node) => node.name);
  equal(names.length, 5);
  equal(names.includes(""), true);
  equal(names.includes("123"), true);
  equal(names.includes("foo-bar"), true);
  equal(names.includes("if"), true);
  equal(names.includes(Buffer.from([0x80]).toString("latin1")), true);
});

test("extractZigManifestMetadata > rejects named fields in every paths occurrence", () => {
  const manifests = [
    `.{ .name = .app, .version = "1.0.0", .paths = .{ .named = "src" }, .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .paths = .{ .named = "bad" }, .paths = .{ "src" }, .dependencies = .{} }`
  ];

  for (const manifest of manifests) {
    const result = parseZigZonText(manifest, "build.zig.zon");
    equal(result.ok, false);
    equal(extractZigManifestMetadata(manifest), undefined);
  }
});

test("parseZigZonText > rejects invalid integer underscore placement", () => {
  for (const fingerprint of [
    "0x_c96e70cf00000001",
    "0xc96e__70cf00000001",
    "0xc96e70cf00000001_",
    "0b_1",
    "1_",
    "1__0"
  ]) {
    const manifest = `.{
      .name = .app,
      .version = "1.0.0",
      .fingerprint = ${fingerprint},
      .dependencies = .{},
    }`;

    equal(parseZigZonText(manifest, "build.zig.zon").ok, false);
    equal(extractZigManifestMetadata(manifest), undefined);
  }
});

test("parseZigZonText > validates every duplicate dependency occurrence", () => {
  const manifests = [
    `.{ .name = .app, .version = "1.0.0", .dependencies = .{
      .dep = "bad",
      .dep = .{ .path = "vendor/dep" },
    } }`,
    `.{ .name = .app, .version = "1.0.0", .dependencies = .{
      .dep = .{ .path = "vendor/dep", .hash = true, .hash = "1220aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    } }`,
    `.{ .name = .app, .version = "1.0.0", .dependencies = .{
      .dep = .{ .path = "vendor/dep", .lazy = "bad", .lazy = false },
    } }`
  ];

  for (const manifest of manifests) {
    const result = parseZigZonText(manifest, "build.zig.zon");
    equal(result.ok, false);
  }
});

test("parseZigZonText > decodes Zig hex and Unicode string escapes", () => {
  const result = parseZigZonText(`.{
    .name = .myproject,
    .version = "0.1.0",
    .dependencies = .{
      .local_lib = .{ .path = "vendor\\x2f\\u{64}ep" },
    },
  }`, "build.zig.zon");

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.nodes[0]?.version, "vendor/dep");
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

test("parseZigZonText > bounds recursive struct nesting", () => {
  const input = `${".{ ".repeat(20_000)}"leaf"${" }".repeat(20_000)}`;
  const result = parseZigZonText(input, "build.zig.zon");

  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
    equal(result.error.details?.reason, "nesting_too_deep");
  }
});

test("parseZigZonText > rejects invalid struct separators and raw string newlines", () => {
  const invalidManifests = [
    `.{ .name = .app, .version = "1.0.0", "extra", .dependencies = .{} }`,
    `.{ .name = .app .version = "1.0.0", .dependencies = .{} }`,
    `.{ .name = .app,, .version = "1.0.0", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .unknown = "bad
value", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .unknown = "bad\tvalue", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .unknown = "bad\u007fvalue", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .unknown = -, .dependencies = .{} }`,
    `.{ .name = .app, .version = "bad\\x2", .dependencies = .{} }`,
    `.{ .name = .app, .version = "bad\\xGG", .dependencies = .{} }`,
    `.{ .name = .app, .version = "bad\\u{}", .dependencies = .{} }`,
    `.{ .name = .app, .version = "bad\\u{110000}", .dependencies = .{} }`,
    `.{ .name = .app, .version = "bad\\u{d800}", .dependencies = .{} }`,
    `.{ .name = .app, .version = "bad\\u{12", .dependencies = .{} }`
  ];

  for (const manifest of invalidManifests) {
    const result = parseZigZonText(manifest, "build.zig.zon");
    equal(result.ok, false);
    if (result.ok) continue;
    equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
  }
});

test("extractZigManifestMetadata > preserves non-UTF-8 Zig path bytes", () => {
  const metadata = extractZigManifestMetadata(`.{
    .name = .app,
    .version = "1.0.0",
    .paths = .{ "\\x80" },
  }`);

  equal(metadata?.paths?.length, 1);
  equal(metadata?.paths?.[0]?.charCodeAt(0), 0x80);
});

test("extractZigManifestMetadata > accepts an underscored Zig fingerprint", () => {
  const metadata = extractZigManifestMetadata(`.{
    .name = .ohrisk_conformance,
    .version = "1.0.0",
    .fingerprint = 0x3d99_ed06_1234_5678,
    .paths = .{ "" },
  }`);

  equal(metadata?.fingerprint, 0x3d99ed0612345678n);
});

test("parseZigZonText > rejects unsupported root and dependency fields fail-closed", () => {
  const manifests = [
    `.{ .name = .app, .version = "1.0.0", .unknown = "ignored by Zig", .dependencies = .{} }`,
    `.{ .name = .app, .version = "1.0.0", .dependencies = .{
      .dep = .{ .path = "vendor/dep", .unknown = true },
    } }`
  ];

  for (const manifest of manifests) {
    const result = parseZigZonText(manifest, "build.zig.zon");
    equal(result.ok, false);
    if (result.ok) continue;
    equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
  }
});

test("parseZigZonText > rejects a non-struct dependencies field", () => {
  const result = parseZigZonText(`.{
    .name = .app,
    .version = "1.0.0",
    .dependencies = "not-a-struct",
  }`, "build.zig.zon");

  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
});

test("parseZigZonText > rejects a non-struct dependency record", () => {
  const result = parseZigZonText(`.{
    .name = .app,
    .version = "1.0.0",
    .dependencies = .{
      .dep = "not-a-struct",
    },
  }`, "build.zig.zon");

  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
});

test("parseZigZonText > requires exactly one dependency location", () => {
  const invalidRecords = [
    `.{ .url = "https://example.com/pkg.tar.gz", .path = "vendor/pkg" }`,
    `.{ .path = "vendor/pkg", .path = "vendor/pkg" }`,
    `.{ .hash = "1220${"a".repeat(64)}" }`
  ];

  for (const record of invalidRecords) {
    const result = parseZigZonText(`.{
      .name = .app,
      .version = "1.0.0",
      .dependencies = .{ .dep = ${record} },
    }`, "build.zig.zon");

    equal(result.ok, false);
    if (result.ok) continue;
    equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
  }
});

test("parseZigZonText > rejects positional and mistyped dependency contents", () => {
  const invalidDependencies = [
    `.{ .{ .path = "vendor/anonymous" } }`,
    `.{ .dep = .{ .path = "vendor/dep", "extra" } }`,
    `.{ .dep = .{ .url = 123, .path = "vendor/dep" } }`,
    `.{ .dep = .{ .path = "vendor/dep", .hash = 123 } }`,
    `.{ .dep = .{ .path = "vendor/dep", .lazy = "yes" } }`
  ];

  for (const dependencies of invalidDependencies) {
    const result = parseZigZonText(`.{
      .name = .app,
      .version = "1.0.0",
      .dependencies = ${dependencies},
    }`, "build.zig.zon");

    equal(result.ok, false);
    if (result.ok) continue;
    equal(result.error.code, "ZIG_ZON_PARSE_FAILED");
  }
});

test("parseZigZonText > rejects trailing tokens after the root value", () => {
  const result = parseZigZonText(
    `.{ .name = .app, .dependencies = .{} } .{ .name = .hidden }`,
    "build.zig.zon"
  );

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
    .name = .version_probe,
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

test("parseZigZonText > uses the URL version for Zig's naked tarball hash placeholder", () => {
  const input = `.{
    .name = .zls,
    .version = "0.17.0-dev",
    .dependencies = .{
        .tracy = .{
            .url = "https://github.com/wolfpld/tracy/archive/refs/tags/v0.13.1.tar.gz",
            .hash = "N-V-__8AAOncKwEm1F9c5LrT7HMNmRMYX8-fAoqpc6YyTu9X",
        },
    },
}`;

  const result = parseZigZonText(input, "build.zig.zon");
  equal(result.ok, true);
  if (!result.ok) return;

  const dep = result.value.nodes[0]!;
  equal(dep.version, "0.13.1");
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

test("parseZigHash > parses Zig's N-V placeholder for naked tarballs", () => {
  const hash = "N-V-__8AAOncKwEm1F9c5LrT7HMNmRMYX8-fAoqpc6YyTu9X";

  const result = parseZigHash(hash);
  equal(result?.format, "new");
  if (result?.format !== "new") return;
  equal(result.name, "N");
  equal(result.version, "V");
  equal(result.hashPlus, "__8AAOncKwEm1F9c5LrT7HMNmRMYX8-fAoqpc6YyTu9X");
});

test("parseZigHash > keeps hyphens inside semantic versions", () => {
  const hashPlus = "A".repeat(44);
  const result = parseZigHash(`mypkg-1.2.3-dev.1-${hashPlus}`);
  equal(result?.format, "new");
  if (result?.format !== "new") return;
  equal(result.name, "mypkg");
  equal(result.version, "1.2.3-dev.1");
  equal(result.hashPlus, hashPlus);
});

test("parseZigHash > returns null for invalid hash", () => {
  equal(parseZigHash("invalid"), null);
  equal(parseZigHash(""), null);
});

test("parseZigHash > rejects hash identities Zig cannot produce", () => {
  const oldHash = `1220${"a".repeat(64)}`;
  const hashPlus = "A".repeat(44);

  equal(parseZigHash(oldHash.toUpperCase()), null);
  equal(parseZigHash(` ${oldHash}`), null);
  equal(parseZigHash(`${oldHash}\n`), null);
  equal(parseZigHash(`${"a".repeat(33)}-1.0.0-${hashPlus}`), null);
  equal(parseZigHash(`pkg-${"1".repeat(33)}-${hashPlus}`), null);
  equal(parseZigHash(`pkg-not-semver-${hashPlus}`), null);
  equal(parseZigHash(`pkg-18446744073709551616.0.0-${hashPlus}`), null);
});
