import type { GraphGateOutcome } from "../../types/report-types";
import type { ComparisonCompleteness, ScanCompleteness } from "./completeness";

/** Collection completion does not prove that dependency relationships are known. */
export function buildGraphGate(input: {
  required: boolean;
  completeness: ScanCompleteness | ComparisonCompleteness;
}): GraphGateOutcome {
  const scans = "baseline" in input.completeness
    ? [input.completeness.baseline, input.completeness.current]
    : [input.completeness];
  return {
    required: input.required,
    failed: input.required && scans.some((scan) => scan.dimensions?.graph.status !== "complete")
  };
}
