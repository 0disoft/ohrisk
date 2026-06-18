export type NormalizedLicenseSignal =
  | "missing"
  | "malformed"
  | "custom-text"
  | "commercial-restriction"
  | "notice-required";

export type NormalizedLicenseConfidence =
  | "high"
  | "medium"
  | "low";

export type NormalizedLicenseJoiner =
  | "single"
  | "and"
  | "or"
  | "mixed";

export type NormalizedLicense = {
  packageId: string;
  original?: string;
  expression?: string;
  choices: string[];
  joiner: NormalizedLicenseJoiner;
  signals: NormalizedLicenseSignal[];
  evidenceSources: string[];
  confidence: NormalizedLicenseConfidence;
};
