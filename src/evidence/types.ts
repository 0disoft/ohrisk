export type LicenseEvidenceFileKind =
  | "license"
  | "notice"
  | "copying"
  | "other";

export type LicenseEvidenceFile = {
  path: string;
  kind: LicenseEvidenceFileKind;
  text: string;
  /** A bundled component license is cumulative evidence, not the package's own declaration. */
  scope?: "component";
};

export type LicenseEvidenceSource =
  | "local"
  | "registry"
  | "sbom"
  | "tarball"
  | "unavailable";

export type MetadataLicenseKind = "declared" | "classifier";

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
  /** Internal verified Go module graph edges; not serialized into report contracts. */
  goModuleRequirements?: string[];
  /** License claims preserved from conflicting artifacts merged into one package node. */
  conflictingLicenseClaims?: string[];
  packageJsonPrivate?: boolean;
  packageJsonLicense?: string;
  packageJsonLicenses?: unknown;
  metadataLicense?: string;
  metadataLicenseKind?: MetadataLicenseKind;
  metadataLicenses?: unknown;
  metadataSource?: string;
  /** SPDX SBOM assertion made by the package supplier or manifest author. */
  sbomDeclaredLicense?: string;
  /** SPDX SBOM assertion concluded by the SBOM creator or analysis tool. */
  sbomConcludedLicense?: string;
  files: LicenseEvidenceFile[];
  source: LicenseEvidenceSource;
  warnings: string[];
};
