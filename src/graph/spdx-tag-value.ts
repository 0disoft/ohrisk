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
  let insideTextBlock = false;

  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();

    if (insideTextBlock) {
      if (line.includes("</text>")) {
        insideTextBlock = false;
      }
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
    const value = line.slice(separatorIndex + 1).trim();
    if (startsUnclosedTextBlock(value)) {
      insideTextBlock = true;
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
        const relationship = readRelationship(value);
        if (relationship) {
          document.relationships.push(relationship);
        }
        break;
      }
    }
  }

  if (insideTextBlock) {
    return spdxTagValueParseError({
      lockfilePath,
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

function readRelationship(value: string): SpdxTagValueRelationship | undefined {
  const parts = value.split(/\s+/).filter((part) => part !== "");
  if (parts.length < 3) {
    return undefined;
  }

  const [spdxElementId, relationshipType, relatedSpdxElement] = parts;
  if (!spdxElementId || !relationshipType || !relatedSpdxElement) {
    return undefined;
  }

  return {
    spdxElementId,
    relationshipType,
    relatedSpdxElement
  };
}

function readSpdxRefList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((ref) => ref.trim())
    .filter((ref) => ref.startsWith("SPDXRef-"));
}

function startsUnclosedTextBlock(value: string): boolean {
  return value.includes("<text>") && !value.includes("</text>");
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
