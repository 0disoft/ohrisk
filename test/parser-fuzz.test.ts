import { describe, expect, test } from "bun:test";

import { collectTarballEvidence } from "../src/evidence/tarball";
import { collectZipPackageEvidence } from "../src/evidence/zip-package";
import { parseLockfileTextForKind } from "../src/graph/project-lockfile";
import { registeredEcosystemAdapters } from "../src/ecosystems/registry";
import { PARSER_FUZZ_SEEDS, preserveParserFailure, recordParserProbe, seededParserInputs } from "./support/parser-fuzz";

const PARSER_KINDS = [...new Set(registeredEcosystemAdapters().flatMap((adapter) => adapter.lockfileKinds))].sort();

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
    for (const seed of PARSER_FUZZ_SEEDS) {
      test(`${kind} safely returns typed results for seed ${seed.toString(16)}`, () => {
        for (const [index, text] of seededParserInputs(seed).entries()) {
          recordParserProbe({ kind, seed, index, text, status: "running" });
          try {
            const result = parseLockfileTextForKind({ kind, text,
              lockfilePath: `fuzz/${kind}-${seed}-${index}.lock`, projectRoot: "fuzz" });
            expect(typeof result.ok).toBe("boolean");
            if (result.ok) {
              const ids = result.value.nodes.map((node) => node.id);
              expect(new Set(ids).size).toBe(ids.length);
              for (const edge of result.value.edges ?? []) {
                expect(ids.includes(edge.to)).toBe(true);
                if (edge.from !== undefined) expect(ids.includes(edge.from)).toBe(true);
              }
            } else {
              expect(result.error.code.length).toBeGreaterThan(0);
              expect(result.error.message.length).toBeGreaterThan(0);
            }
          } catch (cause) {
            preserveParserFailure({ kind, seed, index, text }, cause);
          }
        }
        recordParserProbe({ kind, seed, status: "passed" });
      });
    }
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

  for (const seed of PARSER_FUZZ_SEEDS) {
    test(`archive readers reject seeded corrupt bytes (${seed.toString(16)}) within their declared limits`, () => {
      for (const [index, text] of seededParserInputs(seed, 16).entries()) {
        const bytes = Buffer.from(text);
        try {
          expect(() => collectTarballEvidence({ packageId: "fuzz@1.0.0", tarball: bytes,
            unpackedMaxBytes: 1024, maxEntries: 8 })).not.toThrow();
          expect(() => collectZipPackageEvidence({ packageId: "fuzz@1.0.0", packageName: "fuzz",
            packageVersion: "1.0.0", zip: bytes, maxEntries: 8, entryMaxBytes: 1024 })).not.toThrow();
        } catch (cause) {
          preserveParserFailure({ kind: "archive", seed, index, bytesBase64: bytes.toString("base64") }, cause);
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
