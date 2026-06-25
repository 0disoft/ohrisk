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
import { childNodes, childText, firstChild, parseXmlDocument, type XmlNode } from "./xml";

type SpdxRdfDocument = {
  name?: string;
  documentDescribes?: string[];
  packages: SpdxRdfPackage[];
  relationships: SpdxRdfRelationship[];
};

type SpdxRdfPackage = {
  SPDXID?: string;
  name?: string;
  versionInfo?: string;
  licenseConcluded?: string;
  licenseDeclared?: string;
  externalRefs?: SpdxRdfExternalRef[];
};

type SpdxRdfExternalRef = {
  referenceCategory: string;
  referenceType: string;
  referenceLocator: string;
};

type SpdxRdfRelationship = {
  spdxElementId: string;
  relationshipType: string;
  relatedSpdxElement: string;
};

type UnsupportedSpdxRdfRelationshipField = "spdxElementId" | "relatedSpdxElement";
type UnsupportedSpdxRdfRelationshipReason =
  | "unsupported_spdx_dependency_relationships"
  | "unsupported_spdx_describes_relationships";

export function parseSpdxRdfFile(
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
          ? "SPDX RDF input exceeded the maximum supported size."
          : "Failed to read SPDX RDF input.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseSpdxRdfText(lockfileText.value, lockfilePath);
}

export function parseSpdxRdfText(
  input: string,
  lockfilePath = "spdx.rdf"
): Result<DependencyGraph, OhriskError> {
  const root = parseXmlDocument(input, lockfilePath, spdxRdfParseError);
  if (!root.ok) {
    return root;
  }

  const document = spdxRdfXmlToDocument(root.value, lockfilePath);
  if (!document.ok) {
    return document;
  }

  return parseSpdxDocument(document.value, lockfilePath);
}

function spdxRdfXmlToDocument(
  root: XmlNode,
  lockfilePath: string
): Result<SpdxRdfDocument, OhriskError> {
  if (root.name !== "RDF" && root.name !== "SpdxDocument") {
    return spdxRdfParseError(lockfilePath, "SPDX RDF input must use an <rdf:RDF> or <spdx:SpdxDocument> root element.");
  }

  const documentNode = root.name === "SpdxDocument"
    ? root
    : firstChild(root, "SpdxDocument");
  const document: SpdxRdfDocument = {
    packages: nodesByName(root, "Package")
      .map(readSpdxRdfPackage)
      .filter((pkg) => pkg.SPDXID !== undefined),
    relationships: []
  };
  for (const [index, relationshipNode] of nodesByName(root, "Relationship").entries()) {
    const relationship = readSpdxRdfRelationship({
      node: relationshipNode,
      lockfilePath,
      relationshipIndex: index
    });
    if (!relationship.ok) {
      return relationship;
    }

    if (relationship.value) {
      document.relationships.push(relationship.value);
    }
  }

  const documentName = documentNode
    ? childText(documentNode, "name") ?? childText(documentNode, "documentName")
    : undefined;
  if (documentName) {
    document.name = documentName;
  }

  const described = documentNode ? readDocumentDescribes(documentNode) : [];
  if (described.length > 0) {
    document.documentDescribes = described;
  }

  return ok(document);
}

function readSpdxRdfPackage(node: XmlNode): SpdxRdfPackage {
  const packageId = readSpdxRef(node.attributes.about)
    ?? readSpdxRef(readResourceOrText(firstChild(node, "SPDXID")))
    ?? readSpdxRef(childText(node, "SPDXID"));
  const externalRefs = readSpdxRdfExternalRefs(node);
  const name = childText(node, "packageName") ?? childText(node, "name");
  const versionInfo = childText(node, "packageVersion") ?? childText(node, "versionInfo");
  const licenseConcluded = readSpdxLicenseChild(node, "licenseConcluded");
  const licenseDeclared = readSpdxLicenseChild(node, "licenseDeclared");

  return {
    ...(packageId ? { SPDXID: packageId } : {}),
    ...(name ? { name } : {}),
    ...(versionInfo ? { versionInfo } : {}),
    ...(licenseConcluded ? { licenseConcluded } : {}),
    ...(licenseDeclared ? { licenseDeclared } : {}),
    ...(externalRefs.length > 0 ? { externalRefs } : {})
  };
}

function readSpdxRdfExternalRefs(node: XmlNode): SpdxRdfExternalRef[] {
  return childNodes(node, "externalRef")
    .map((externalRef) => firstChild(externalRef, "ExternalRef") ?? externalRef)
    .map((externalRef) => {
      const category = normalizeExternalRefCategory(readResourceOrText(firstChild(externalRef, "referenceCategory")));
      const type = normalizeExternalRefType(readResourceOrText(firstChild(externalRef, "referenceType")));
      const locator = childText(externalRef, "referenceLocator");

      if (!category || !type || !locator) {
        return undefined;
      }

      return {
        referenceCategory: category,
        referenceType: type,
        referenceLocator: locator
      };
    })
    .filter((externalRef): externalRef is SpdxRdfExternalRef => externalRef !== undefined);
}

function readSpdxRdfRelationship(input: {
  node: XmlNode;
  lockfilePath: string;
  relationshipIndex: number;
}): Result<SpdxRdfRelationship | undefined, OhriskError> {
  const spdxElementId = readSpdxRef(readResourceOrText(firstChild(input.node, "spdxElement")))
    ?? readSpdxRef(readResourceOrText(firstChild(input.node, "spdxElementId")))
    ?? readSpdxRef(input.node.attributes.about);
  const relationshipType = normalizeRelationshipType(readResourceOrText(firstChild(input.node, "relationshipType")));
  const relatedSpdxElement = readSpdxRef(readResourceOrText(firstChild(input.node, "relatedSpdxElement")));

  if (isSpdxDependencyRelationshipType(relationshipType)) {
    const unsupportedRelationshipFields: UnsupportedSpdxRdfRelationshipField[] = [
      ...(!spdxElementId ? ["spdxElementId" as const] : []),
      ...(!relatedSpdxElement ? ["relatedSpdxElement" as const] : [])
    ];
    if (unsupportedRelationshipFields.length > 0) {
      return unsupportedSpdxRdfRelationshipError({
        lockfilePath: input.lockfilePath,
        reason: "unsupported_spdx_dependency_relationships",
        relationshipIndex: input.relationshipIndex,
        unsupportedRelationshipFields
      });
    }
  }

  if (relationshipType === "DESCRIBES") {
    const unsupportedRelationshipFields: UnsupportedSpdxRdfRelationshipField[] = [
      ...(!spdxElementId ? ["spdxElementId" as const] : []),
      ...(!relatedSpdxElement ? ["relatedSpdxElement" as const] : [])
    ];
    if (unsupportedRelationshipFields.length > 0) {
      return unsupportedSpdxRdfRelationshipError({
        lockfilePath: input.lockfilePath,
        reason: "unsupported_spdx_describes_relationships",
        relationshipIndex: input.relationshipIndex,
        unsupportedRelationshipFields
      });
    }
  }

  if (!spdxElementId || !relationshipType || !relatedSpdxElement) {
    return ok(undefined);
  }

  return ok({
    spdxElementId,
    relationshipType,
    relatedSpdxElement
  });
}

function readDocumentDescribes(node: XmlNode): string[] {
  const refs = new Set<string>();
  for (const child of [
    ...childNodes(node, "describesPackage"),
    ...childNodes(node, "documentDescribes")
  ]) {
    const resourceRef = readSpdxRef(readResourceOrText(child));
    if (resourceRef) {
      refs.add(resourceRef);
    }

    for (const textRef of (child.text || "").split(/[,\s]+/)) {
      const ref = readSpdxRef(textRef);
      if (ref) {
        refs.add(ref);
      }
    }
  }

  return [...refs].sort();
}

function readSpdxLicenseChild(node: XmlNode, name: string): string | undefined {
  const value = readResourceOrText(firstChild(node, name));
  if (!value) {
    return undefined;
  }

  const term = resourceTerm(value);
  if (term.toLowerCase() === "noassertion") {
    return "NOASSERTION";
  }

  if (term.toLowerCase() === "none") {
    return "NONE";
  }

  return term.replace(/^licenseId_/i, "");
}

function readResourceOrText(node: XmlNode | undefined): string | undefined {
  const value = node?.attributes.resource
    ?? node?.attributes.about
    ?? childText(node, "resource")
    ?? node?.text.trim();
  return value === "" ? undefined : value;
}

function readSpdxRef(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const term = resourceTerm(value);
  return term.startsWith("SPDXRef-") ? term : undefined;
}

function normalizeRelationshipType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const term = resourceTerm(value).replace(/^relationshipType_/i, "");
  if (/^depends[-_ ]?on$/i.test(term) || /^dependson$/i.test(term)) {
    return "DEPENDS_ON";
  }

  if (/^dependency[-_ ]?of$/i.test(term) || /^dependencyof$/i.test(term)) {
    return "DEPENDENCY_OF";
  }

  if (/^describes$/i.test(term)) {
    return "DESCRIBES";
  }

  const normalized = term.replace(/[-\s]+/g, "_").toUpperCase();
  return ["DEPENDS_ON", "DEPENDENCY_OF", "DESCRIBES"].includes(normalized)
    ? normalized
    : undefined;
}

function isSpdxDependencyRelationshipType(value: string | undefined): value is "DEPENDS_ON" | "DEPENDENCY_OF" {
  return value === "DEPENDS_ON" || value === "DEPENDENCY_OF";
}

function normalizeExternalRefCategory(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = resourceTerm(value).replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return normalized === "packagemanager" || normalized.endsWith("packagemanager")
    ? "PACKAGE-MANAGER"
    : undefined;
}

function normalizeExternalRefType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return resourceTerm(value).toLowerCase() === "purl"
    ? "purl"
    : undefined;
}

function resourceTerm(value: string): string {
  const trimmed = value.trim();
  const hashIndex = trimmed.lastIndexOf("#");
  const slashIndex = trimmed.lastIndexOf("/");
  const termStart = Math.max(hashIndex, slashIndex);
  const term = termStart === -1 ? trimmed : trimmed.slice(termStart + 1);

  try {
    return decodeURIComponent(term);
  } catch {
    return term;
  }
}

function nodesByName(node: XmlNode, name: string): XmlNode[] {
  return [
    ...(node.name === name ? [node] : []),
    ...node.children.flatMap((child) => nodesByName(child, name))
  ];
}

function spdxRdfParseError(
  lockfilePath: string,
  cause: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "SPDX_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse SPDX RDF input.",
      details: {
        lockfilePath,
        cause
      }
    })
  );
}

function unsupportedSpdxRdfRelationshipError(input: {
  lockfilePath: string;
  reason: UnsupportedSpdxRdfRelationshipReason;
  relationshipIndex: number;
  unsupportedRelationshipFields: UnsupportedSpdxRdfRelationshipField[];
}): Result<never, OhriskError> {
  const relationshipLabel = input.reason === "unsupported_spdx_describes_relationships"
    ? "DESCRIBES relationships"
    : "dependency relationships";

  return err(
    createError({
      code: "SPDX_PARSE_FAILED",
      category: "unsupported_input",
      message: `Failed to parse SPDX RDF ${relationshipLabel}. Ohrisk supports complete SPDX relationship references.`,
      details: {
        lockfilePath: input.lockfilePath,
        reason: input.reason,
        relationshipIndexes: [input.relationshipIndex],
        unsupportedRelationshipFields: input.unsupportedRelationshipFields
      }
    })
  );
}
