import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { parseCycloneDxDocument } from "./cyclonedx-json";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph } from "./types";
import { childNodes, childText, firstChild, parseXmlDocument, type XmlNode } from "./xml";

export function parseCycloneDxXmlFile(
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
        code: "CYCLONEDX_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "CycloneDX XML input exceeded the maximum supported size."
          : "Failed to read CycloneDX XML input.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseCycloneDxXmlText(lockfileText.value, lockfilePath);
}

export function parseCycloneDxXmlText(
  input: string,
  lockfilePath = "cyclonedx.xml"
): Result<DependencyGraph, OhriskError> {
  const root = parseXmlDocument(input, lockfilePath, cycloneDxXmlParseError);
  if (!root.ok) {
    return root;
  }

  const bom = cycloneDxXmlToDocument(root.value, lockfilePath);
  if (!bom.ok) {
    return bom;
  }

  return parseCycloneDxDocument(bom.value, lockfilePath);
}

function cycloneDxXmlToDocument(
  root: XmlNode,
  lockfilePath: string
): Result<Record<string, unknown>, OhriskError> {
  if (root.name !== "bom") {
    return cycloneDxXmlParseError(lockfilePath, "CycloneDX XML input must use a <bom> root element.");
  }

  const document: Record<string, unknown> = {
    bomFormat: "CycloneDX",
    components: readCycloneDxXmlComponents(firstChild(root, "components")),
    dependencies: readCycloneDxXmlDependencies(firstChild(root, "dependencies"))
  };
  const metadata = readCycloneDxXmlMetadata(firstChild(root, "metadata"));
  if (metadata) {
    document.metadata = metadata;
  }

  return ok(document);
}

function readCycloneDxXmlMetadata(node: XmlNode | undefined): Record<string, unknown> | undefined {
  const component = firstChild(node, "component");
  if (!component) {
    return undefined;
  }

  return {
    component: readCycloneDxXmlComponent(component)
  };
}

function readCycloneDxXmlComponents(node: XmlNode | undefined): Record<string, unknown>[] {
  return childNodes(node, "component").map(readCycloneDxXmlComponent);
}

function readCycloneDxXmlComponent(node: XmlNode): Record<string, unknown> {
  const component: Record<string, unknown> = {};

  copyStringAttribute(node, component, "bom-ref");
  copyStringAttribute(node, component, "type");
  copyStringChild(node, component, "name");
  copyStringChild(node, component, "version");
  copyStringChild(node, component, "purl");
  copyStringChild(node, component, "scope");

  const licenses = readCycloneDxXmlLicenses(firstChild(node, "licenses"));
  if (licenses.length > 0) {
    component.licenses = licenses;
  }

  const properties = readCycloneDxXmlProperties(firstChild(node, "properties"));
  if (properties.length > 0) {
    component.properties = properties;
  }

  return component;
}

function readCycloneDxXmlLicenses(node: XmlNode | undefined): Record<string, unknown>[] {
  if (!node) {
    return [];
  }

  const licenses: Record<string, unknown>[] = [];
  for (const expression of childNodes(node, "expression")) {
    if (expression.text.trim() !== "") {
      licenses.push({ expression: expression.text.trim() });
    }
  }

  for (const license of childNodes(node, "license")) {
    const expression = childText(license, "expression");
    if (expression) {
      licenses.push({ expression });
      continue;
    }

    const id = childText(license, "id");
    const name = childText(license, "name");
    if (id || name) {
      licenses.push({
        license: {
          ...(id ? { id } : {}),
          ...(name ? { name } : {})
        }
      });
    }
  }

  return licenses;
}

function readCycloneDxXmlProperties(node: XmlNode | undefined): Record<string, string>[] {
  if (!node) {
    return [];
  }

  return childNodes(node, "property")
    .map((property) => {
      const value = property.attributes.value ?? property.text.trim();
      return {
        name: property.attributes.name ?? "",
        value
      };
    })
    .filter((property) => property.name !== "" && property.value !== "");
}

function readCycloneDxXmlDependencies(node: XmlNode | undefined): Record<string, unknown>[] {
  return childNodes(node, "dependency")
    .map((dependency) => ({
      ref: dependency.attributes.ref ?? "",
      dependsOn: childNodes(dependency, "dependency")
        .map((child) => child.attributes.ref ?? childText(child, "ref") ?? child.text.trim())
        .filter((ref) => ref !== "")
    }))
    .filter((dependency) => dependency.ref !== "");
}

function copyStringAttribute(
  node: XmlNode,
  output: Record<string, unknown>,
  name: string
): void {
  const value = node.attributes[name];
  if (value !== undefined && value !== "") {
    output[name] = value;
  }
}

function copyStringChild(
  node: XmlNode,
  output: Record<string, unknown>,
  name: string
): void {
  const value = childText(node, name);
  if (value) {
    output[name] = value;
  }
}

function cycloneDxXmlParseError(
  lockfilePath: string,
  cause: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "CYCLONEDX_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse CycloneDX XML input.",
      details: {
        lockfilePath,
        cause
      }
    })
  );
}
