import heldoutJson from "../evaluation/license-heldout.json" with { type: "json" };

import {
  evaluateHeldoutLicenseCases,
  renderHeldoutLicenseReport,
  validateHeldoutLicenseDataset,
  type HeldoutLicenseCase
} from "./license-heldout";

const validationErrors = validateHeldoutLicenseDataset(heldoutJson);
if (validationErrors.length > 0) {
  for (const message of validationErrors) {
    console.error(message);
  }
  process.exitCode = 1;
} else {
  const result = evaluateHeldoutLicenseCases(heldoutJson as HeldoutLicenseCase[]);
  process.stdout.write(renderHeldoutLicenseReport(result));
  if (result.summary.ohriskDecisionMismatches > 0) {
    process.exitCode = 1;
  }
}
