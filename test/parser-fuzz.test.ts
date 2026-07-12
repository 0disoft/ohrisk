import { describe, expect, test } from "bun:test";

import { collectTarballEvidence } from "../src/evidence/tarball";
import { collectZipPackageEvidence } from "../src/evidence/zip-package";
import { parseLockfileTextForKind } from "../src/graph/project-lockfile";
import type { SupportedLockfileKind } from "../src/project/discover";

const PARSER_KINDS: SupportedLockfileKind[] = [
  "package-lock",
  "pnpm-lock",
  "cyclonedx-json",
  "cyclonedx-xml",
  "spdx-json",
  "spdx-rdf",
  "pyproject-toml",
  "terraform-lock",
  "maven-pom",
  "composer-lock",
  "go-mod",
  "requirements-txt"
];

const MALFORMED_TEXT_CORPUS = [
  "",
  "\0",
  "{",
  "[1,",
  "<root><unclosed>",
  "a: &recursive [*recursive]",
  "name = \"unterminated",
  "../".repeat(256),
  "A".repeat(4096),
  "\ud800"
];

describe("deterministic parser fuzzing", () => {
  for (const kind of PARSER_KINDS) {
    test(`${kind} returns a typed result for malformed input`, () => {
      for (const [index, text] of MALFORMED_TEXT_CORPUS.entries()) {
        let result: ReturnType<typeof parseLockfileTextForKind> | undefined;
        expect(() => {
          result = parseLockfileTextForKind({
            kind,
            text,
            lockfilePath: `fuzz/${kind}-${index}.lock`,
            projectRoot: "fuzz"
          });
        }).not.toThrow();

        expect(typeof result?.ok).toBe("boolean");
        if (result && !result.ok) {
          expect(result.error.code.length).toBeGreaterThan(0);
          expect(result.error.message.length).toBeGreaterThan(0);
        }
      }
    });
  }

  test("archive evidence readers reject malformed bytes without throwing", () => {
    const byteCorpus = [
      Buffer.alloc(0),
      Buffer.from([0]),
      Buffer.from("not an archive"),
      Buffer.alloc(512, 0xff),
      Buffer.from("PK\x03\x04truncated", "binary")
    ];

    for (const bytes of byteCorpus) {
      expect(() => collectTarballEvidence({
        packageId: "fuzz@1.0.0",
        tarball: bytes,
        unpackedMaxBytes: 1024,
        maxEntries: 8
      })).not.toThrow();

      expect(() => collectZipPackageEvidence({
        packageId: "fuzz@1.0.0",
        packageName: "fuzz",
        packageVersion: "1.0.0",
        zip: bytes,
        maxEntries: 8,
        entryMaxBytes: 1024
      })).not.toThrow();
    }
  });
});
