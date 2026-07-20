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
  | "registry"
  | "sbom"
  | "tarball"
  | "unavailable";

export type EvidenceDiagnosticCode =
  | "collector_warning"
  | "license_evidence_missing"
  | "source_unavailable";

export type EvidenceDiagnostic = {
  code: EvidenceDiagnosticCode;
  source: LicenseEvidenceSource;
  packageCount: number;
  occurrenceCount: number;
};

export type EvidenceSourceCounts = {
  packages: number;
  files: number;
  warnings: number;
};

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
