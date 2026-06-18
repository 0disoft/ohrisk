export type NormalizedLicenseSignal =
  | "missing"
  | "malformed"
  | "custom-text"
  | "notice-required";

export type NormalizedLicenseConfidence =
  | "high"
  | "medium"
  | "low";

export type NormalizedLicense = {
  packageId: string;
  original?: string;
  expression?: string;
  choices: string[];
  signals: NormalizedLicenseSignal[];
  evidenceSources: string[];
  confidence: NormalizedLicenseConfidence;
};
