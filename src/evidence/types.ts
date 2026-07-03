export type LicenseEvidenceFileKind =
  | "license"
  | "notice"
  | "copying"
  | "other";

export type LicenseEvidenceFile = {
  path: string;
  kind: LicenseEvidenceFileKind;
  text: string;
};

export type LicenseEvidenceSource =
  | "local"
  | "sbom"
  | "tarball"
  | "unavailable";

export type LicenseEvidence = {
  packageId: string;
  packageJsonPrivate?: boolean;
  packageJsonLicense?: string;
  packageJsonLicenses?: unknown;
  metadataLicense?: string;
  metadataLicenses?: unknown;
  metadataSource?: string;
  files: LicenseEvidenceFile[];
  source: LicenseEvidenceSource;
  warnings: string[];
};
