import { ok, type Result } from "../shared/result";
import type { OhriskError } from "../shared/errors";
import type { LicenseEvidence } from "./types";

export function collectBazelModuleEvidence(input: {
  packageId: string;
}): Result<LicenseEvidence, OhriskError> {
  return ok({
    packageId: input.packageId,
    files: [],
    source: "unavailable",
    warnings: [
      "Bazel module license evidence was not found locally. Remote Bazel registry metadata fetching is not supported yet."
    ]
  });
}
