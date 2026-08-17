\
import { describe, expect, test } from "bun:test";

import {
  buildDiffEvidenceCompleteness,
  renderIncompleteDiffEvidence
} from "../src/cli/diff-completeness";

describe("diff evidence completeness", () => {
  test("is complete only when both revisions have complete evidence", () => {
    const complete = {
      status: "complete",
      unavailablePackageCount: 0,
      skippedRepositoryEntryCount: 0
    } as const;
    const partial = {
      status: "partial",
      unavailablePackageCount: 1,
      skippedRepositoryEntryCount: 2
    } as const;

    expect(buildDiffEvidenceCompleteness({
      baseline: complete,
      current: complete
    }).status).toBe("complete");
    expect(buildDiffEvidenceCompleteness({
      baseline: complete,
      current: partial
    }).status).toBe("partial");
  });

  test("identifies every partial revision in the failure message", () => {
    const completeness = buildDiffEvidenceCompleteness({
      baseline: {
        status: "partial",
        unavailablePackageCount: 2,
        skippedRepositoryEntryCount: 0
      },
      current: {
        status: "partial",
        unavailablePackageCount: 1,
        skippedRepositoryEntryCount: 3
      }
    });

    expect(renderIncompleteDiffEvidence(completeness)).toBe(
      "Diff evidence is partial for baseline (2 unavailable packages, 0 skipped repository entries) "
      + "and current (1 unavailable packages, 3 skipped repository entries). "
      + "Treat the result as indeterminate and retry after evidence collection succeeds.\n"
    );
  });
});
