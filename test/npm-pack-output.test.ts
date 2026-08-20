import { describe, expect, test } from "bun:test";
import { readNpmPackResult } from "../scripts/npm-pack-output";

describe("readNpmPackResult", () => {
  test("reads the legacy npm array result", () => {
    expect(readNpmPackResult('[{"filename":"ohrisk.tgz"}]', "ohrisk")).toEqual({
      filename: "ohrisk.tgz"
    });
  });

  test("reads direct and npm 12 package-keyed results", () => {
    expect(readNpmPackResult('{"filename":"ohrisk.tgz"}', "ohrisk")).toEqual({
      filename: "ohrisk.tgz"
    });
    expect(
      readNpmPackResult('{"ohrisk":{"filename":"ohrisk.tgz"}}', "ohrisk")
    ).toEqual({ filename: "ohrisk.tgz" });
  });

  test("rejects ambiguous arrays and another package key", () => {
    expect(
      readNpmPackResult(
        '[{"filename":"first.tgz"},{"filename":"second.tgz"}]',
        "ohrisk"
      )
    ).toBeUndefined();
    expect(
      readNpmPackResult('{"another-package":{"filename":"other.tgz"}}', "ohrisk")
    ).toBeUndefined();
  });
});
