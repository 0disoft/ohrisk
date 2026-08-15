import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import { parseSpdxDocument } from "./spdx-json";
import type { DependencyGraph } from "./types";

type SpdxTagValueDocument = {
  name?: string;
  documentDescribes?: string[];
  packages: SpdxTagValuePackage[];
  relationships: SpdxTagValueRelationship[];
  hasExtractedLicensingInfos?: SpdxTagValueExtractedLicensingInfo[];
};

type SpdxTagValueExtractedLicensingInfo = {
  licenseId: string;
  extractedText?: string;
};

type SpdxTagValuePackage = {
  SPDXID?: string;
  name?: string;
  versionInfo?: string;
  licenseConcluded?: string;
  licenseDeclared?: string;
  externalRefs?: SpdxTagValueExternalRef[];
};

type SpdxTagValueExternalRef = {
  referenceCategory: string;
  referenceType: string;
  referenceLocator: string;
};

type SpdxTagValueRelationship = {
  spdxElementId: string;
  relationshipType: string;
  relatedSpdxElement: string;
};

type UnsupportedSpdxTagValueRelationshipField = "spdxElementId" | "relatedSpdxElement";
type UnsupportedSpdxTagValueRelationshipType = "DEPENDS_ON" | "DEPENDENCY_OF" | "DESCRIBES";
type UnsupportedSpdxTagValueRelationshipReason =
  | "unsupported_spdx_dependency_relationships"
  | "unsupported_spdx_describes_relationships";

export function parseSpdxTagValueFile(
  lockfilePath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "SPDX_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "SPDX tag-value input exceeded the maximum supported size."
          : "Failed to read SPDX tag-value input.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseSpdxTagValueText(lockfileText.value, lockfilePath);
}

export function parseSpdxTagValueText(
  input: string,
  lockfilePath = "sbom.spdx"
): Result<DependencyGraph, OhriskError> {
  const document = readSpdxTagValueDocument(input, lockfilePath);
  if (!document.ok) {
    return document;
  }

  return parseSpdxDocument(document.value, lockfilePath);
}

function readSpdxTagValueDocument(
  input: string,
  lockfilePath: string
): Result<SpdxTagValueDocument, OhriskError> {
  const document: SpdxTagValueDocument = {
    packages: [],
    relationships: []
  };
  let currentPackage: SpdxTagValuePackage | undefined;
  let currentExtractedLicensingInfo: SpdxTagValueExtractedLicensingInfo | undefined;
  let textBlock: { tag: string; lines: string[]; line: number } | undefined;

  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();

    if (textBlock) {
      const closingIndex = rawLine.indexOf("</text>");
      if (closingIndex === -1) {
        textBlock.lines.push(rawLine);
        continue;
      }

      textBlock.lines.push(rawLine.slice(0, closingIndex));
      if (textBlock.tag === "ExtractedText" && currentExtractedLicensingInfo) {
        currentExtractedLicensingInfo.extractedText = textBlock.lines.join("\n");
      }
      if (rawLine.slice(closingIndex + "</text>".length).trim() !== "") {
        return spdxTagValueParseError({
          lockfilePath,
          line: index + 1,
          cause: "Unexpected content after a tag-value </text> block."
        });
      }
      textBlock = undefined;
      continue;
    }

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      return spdxTagValueParseError({
        lockfilePath,
        line: index + 1,
        cause: "Expected a tag-value line in the form Tag: value."
      });
    }

    const tag = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    const textOpenIndex = value.indexOf("<text>");
    if (textOpenIndex !== -1) {
      const afterOpen = value.slice(textOpenIndex + "<text>".length);
      const textCloseIndex = afterOpen.indexOf("</text>");
      if (textCloseIndex === -1) {
        textBlock = {
          tag,
          lines: [afterOpen],
          line: index + 1
        };
        continue;
      }
      if (afterOpen.slice(textCloseIndex + "</text>".length).trim() !== "") {
        return spdxTagValueParseError({
          lockfilePath,
          line: index + 1,
          cause: "Unexpected content after a tag-value </text> block."
        });
      }
      value = afterOpen.slice(0, textCloseIndex);
    }

    switch (tag) {
      case "DocumentName":
        document.name = value;
        break;
      case "DocumentDescribes":
        document.documentDescribes = [
          ...(document.documentDescribes ?? []),
          ...readSpdxRefList(value)
        ];
        break;
      case "PackageName":
        currentPackage = {
          name: value
        };
        document.packages.push(currentPackage);
        break;
      case "SPDXID":
        if (currentPackage) {
          currentPackage.SPDXID = value;
        }
        break;
      case "PackageVersion":
        if (currentPackage) {
          currentPackage.versionInfo = value;
        }
        break;
      case "PackageLicenseConcluded":
        if (currentPackage) {
          currentPackage.licenseConcluded = value;
        }
        break;
      case "PackageLicenseDeclared":
        if (currentPackage) {
          currentPackage.licenseDeclared = value;
        }
        break;
      case "ExternalRef":
        if (currentPackage) {
          const externalRef = readExternalRef(value);
          if (externalRef) {
            currentPackage.externalRefs = [
              ...(currentPackage.externalRefs ?? []),
              externalRef
            ];
          }
        }
        break;
      case "Relationship": {
        const relationship = readRelationship({
          value,
          lockfilePath,
          line: index + 1
        });
        if (!relationship.ok) {
          return relationship;
        }

        if (relationship.value) {
          document.relationships.push(relationship.value);
        }
        break;
      }
      case "LicenseID":
        currentPackage = undefined;
        currentExtractedLicensingInfo = { licenseId: value };
        document.hasExtractedLicensingInfos = [
          ...(document.hasExtractedLicensingInfos ?? []),
          currentExtractedLicensingInfo
        ];
        break;
      case "ExtractedText":
        if (currentExtractedLicensingInfo) {
          currentExtractedLicensingInfo.extractedText = value;
        }
        break;
    }
  }

  if (textBlock) {
    return spdxTagValueParseError({
      lockfilePath,
      line: textBlock.line,
      cause: "Unclosed SPDX tag-value <text> block."
    });
  }

  return ok(document);
}

function readExternalRef(value: string): SpdxTagValueExternalRef | undefined {
  const parts = value.split(/\s+/).filter((part) => part !== "");
  if (parts.length < 3) {
    return undefined;
  }

  const [referenceCategory, referenceType, ...locatorParts] = parts;
  if (!referenceCategory || !referenceType) {
    return undefined;
  }

  return {
    referenceCategory,
    referenceType,
    referenceLocator: locatorParts.join(" ")
  };
}

function readRelationship(input: {
  value: string;
  lockfilePath: string;
  line: number;
}): Result<SpdxTagValueRelationship | undefined, OhriskError> {
  const parts = input.value.split(/\s+/).filter((part) => part !== "");
  const relationshipType = parts[1];
  if (isSupportedSpdxRelationshipType(relationshipType) && parts.length < 3) {
    return unsupportedSpdxTagValueRelationshipError({
      lockfilePath: input.lockfilePath,
      line: input.line,
      relationshipType,
      reason: relationshipType === "DESCRIBES"
        ? "unsupported_spdx_describes_relationships"
        : "unsupported_spdx_dependency_relationships",
      unsupportedRelationshipFields: ["relatedSpdxElement"]
    });
  }

  if (parts.length < 3) {
    return ok(undefined);
  }

  const spdxElementId = parts[0];
  const relatedSpdxElement = parts[2];
  if (!spdxElementId || !relationshipType || !relatedSpdxElement) {
    return ok(undefined);
  }

  return ok({
    spdxElementId,
    relationshipType,
    relatedSpdxElement
  });
}

function readSpdxRefList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((ref) => ref.trim())
    .filter((ref) => ref.startsWith("SPDXRef-"));
}

function isSpdxDependencyRelationshipType(
  value: string | undefined
): value is "DEPENDS_ON" | "DEPENDENCY_OF" {
  return value === "DEPENDS_ON" || value === "DEPENDENCY_OF";
}

function isSupportedSpdxRelationshipType(
  value: string | undefined
): value is UnsupportedSpdxTagValueRelationshipType {
  return isSpdxDependencyRelationshipType(value) || value === "DESCRIBES";
}

function unsupportedSpdxTagValueRelationshipError(input: {
  lockfilePath: string;
  line: number;
  relationshipType: UnsupportedSpdxTagValueRelationshipType;
  reason: UnsupportedSpdxTagValueRelationshipReason;
  unsupportedRelationshipFields: UnsupportedSpdxTagValueRelationshipField[];
}): Result<never, OhriskError> {
  const relationshipLabel = input.reason === "unsupported_spdx_describes_relationships"
    ? "DESCRIBES relationship"
    : "dependency relationship";

  return err(
    createError({
      code: "SPDX_PARSE_FAILED",
      category: "unsupported_input",
      message: `Failed to parse SPDX tag-value ${relationshipLabel}. Ohrisk supports complete SPDX relationship references.`,
      details: {
        lockfilePath: input.lockfilePath,
        line: input.line,
        reason: input.reason,
        relationshipType: input.relationshipType,
        unsupportedRelationshipFields: input.unsupportedRelationshipFields
      }
    })
  );
}

function spdxTagValueParseError(input: {
  lockfilePath: string;
  line?: number;
  cause: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "SPDX_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse SPDX tag-value input.",
      details: {
        lockfilePath: input.lockfilePath,
        ...(input.line ? { line: input.line } : {}),
        cause: input.cause
      }
    })
  );
}
