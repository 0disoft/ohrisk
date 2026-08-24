#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const EVIDENCE_SCHEMA = "urn:ohrisk:schema:notices-evidence:1.0.0";
const RESULT_SCHEMA = "urn:ohrisk:schema:notices-result:1.0.0";
const DEFAULT_OUTPUT = "THIRD_PARTY_NOTICES.md";
const MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_EVIDENCE_BYTES = 32 * 1024 * 1024;
const MAX_EVIDENCE_FILES = 2048;

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${renderHelp()}\n`);
    process.exitCode = 0;
  } else {
    process.exitCode = generateNotices(options);
  }
} catch (cause) {
  process.stderr.write(`ohrisk-notices: ${errorMessage(cause)}\n`);
  process.exitCode = 2;
}

function generateNotices(options) {
  const workspace = resolveWorkspace(options.workspace);
  const sbomPath = resolveContainedFile(workspace, options.sbom, "--sbom");
  const outputPath = resolveContainedOutput(
    workspace,
    options.output ?? DEFAULT_OUTPUT,
    "--output"
  );
  const sbom = readCycloneDx(sbomPath);
  const evidence = options.evidence
    ? readEvidenceManifest(resolveContainedFile(workspace, options.evidence, "--evidence"))
    : { packages: [] };
  const evidenceByPurl = new Map(evidence.packages.map((entry) => [entry.purl, entry]));
  const components = sbom.components
    .map(normalizeComponent)
    .filter((component) => options.includeExcluded || component.scope !== "excluded")
    .sort((left, right) => left.purl.localeCompare(right.purl));
  rejectDuplicateComponents(components);

  const documentByDigest = new Map();
  const packages = [];
  const incompletePackages = [];
  const usedEvidencePurls = new Set();
  let evidenceFileCount = 0;
  let totalEvidenceBytes = 0;

  for (const component of components) {
    const packageEvidence = evidenceByPurl.get(component.purl);
    if (packageEvidence) {
      usedEvidencePurls.add(component.purl);
    }
    const missing = [];
    const licenseDocuments = [];
    const noticeDocuments = [];

    if (component.license === null) {
      missing.push("license-declaration");
    }

    if (!packageEvidence || packageEvidence.licenseFiles.length === 0) {
      missing.push("license-text");
    } else {
      for (const relativePath of packageEvidence.licenseFiles) {
        const loaded = loadEvidenceDocument({
          workspace,
          relativePath,
          kind: "license",
          component,
          documentByDigest
        });
        evidenceFileCount += loaded.fileCount;
        totalEvidenceBytes += loaded.byteCount;
        enforceEvidenceBudget(evidenceFileCount, totalEvidenceBytes);
        licenseDocuments.push(loaded.digest);
      }
    }

    if (component.signals.includes("notice-required")) {
      if (!packageEvidence || packageEvidence.noticeFiles.length === 0) {
        missing.push("notice-file");
      }
    }

    if (packageEvidence) {
      for (const relativePath of packageEvidence.noticeFiles) {
        const loaded = loadEvidenceDocument({
          workspace,
          relativePath,
          kind: "notice",
          component,
          documentByDigest
        });
        evidenceFileCount += loaded.fileCount;
        totalEvidenceBytes += loaded.byteCount;
        enforceEvidenceBudget(evidenceFileCount, totalEvidenceBytes);
        noticeDocuments.push(loaded.digest);
      }
    }

    const entry = {
      ...component,
      copyright: packageEvidence?.copyright ?? [],
      licenseDocuments: uniqueSorted(licenseDocuments),
      noticeDocuments: uniqueSorted(noticeDocuments),
      missing: uniqueSorted(missing)
    };
    packages.push(entry);
    if (entry.missing.length > 0) {
      incompletePackages.push(entry);
    }
  }

  const unusedEvidence = evidence.packages
    .filter((entry) => !usedEvidencePurls.has(entry.purl))
    .map((entry) => entry.purl)
    .sort((left, right) => left.localeCompare(right));
  const documents = [...documentByDigest.values()]
    .sort((left, right) => left.digest.localeCompare(right.digest));
  const result = {
    $schema: RESULT_SCHEMA,
    schemaVersion: "1.0.0",
    status: "third_party_notices_generated",
    output: displayPath(workspace, outputPath),
    componentCount: packages.length,
    completeComponentCount: packages.length - incompletePackages.length,
    incompleteComponentCount: incompletePackages.length,
    evidenceDocumentCount: documents.length,
    evidenceFileCount,
    evidenceBytes: totalEvidenceBytes,
    unusedEvidenceCount: unusedEvidence.length,
    incomplete: incompletePackages.length > 0,
    incompletePackages: incompletePackages.map(({ purl, missing }) => ({ purl, missing })),
    unusedEvidence
  };

  const markdown = renderNotices({
    sbom,
    packages,
    documents,
    incompletePackages,
    unusedEvidence
  });
  writeTextAtomically(outputPath, `${markdown}\n`);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Wrote ${result.output} for ${result.componentCount} component${result.componentCount === 1 ? "" : "s"}.`,
      `Embedded ${result.evidenceDocumentCount} unique legal document${result.evidenceDocumentCount === 1 ? "" : "s"}.`,
      result.incomplete
        ? `${result.incompleteComponentCount} component${result.incompleteComponentCount === 1 ? " is" : "s are"} incomplete.`
        : "All included components have the required evidence."
    ].join("\n") + "\n");
  }

  return result.incomplete && !options.allowIncomplete ? 1 : 0;
}

function readCycloneDx(filePath) {
  const parsed = readJson(filePath, "CycloneDX report");
  if (
    !isObject(parsed)
    || parsed.bomFormat !== "CycloneDX"
    || parsed.specVersion !== "1.5"
    || !Array.isArray(parsed.components)
  ) {
    throw new Error("input is not an Ohrisk CycloneDX 1.5 report.");
  }
  return parsed;
}

function normalizeComponent(value) {
  if (!isObject(value)) {
    throw new Error("Every CycloneDX component must be an object.");
  }
  const { name, version, purl, scope } = value;
  if (
    value.type !== "library"
    || typeof name !== "string"
    || name === ""
    || typeof version !== "string"
    || version === ""
    || typeof purl !== "string"
    || purl === ""
    || !["required", "optional", "excluded"].includes(scope)
  ) {
    throw new Error("Every component must contain type=library, name, version, purl, and a supported scope.");
  }
  const properties = propertyMap(value.properties);
  return {
    name,
    version,
    purl,
    scope,
    license: renderLicense(value.licenses),
    ecosystem: properties.get("ohrisk:ecosystem") ?? "unknown",
    dependencyType: properties.get("ohrisk:dependencyType") ?? "unknown",
    direct: properties.get("ohrisk:direct") === "true",
    signals: splitSignals(properties.get("ohrisk:licenseSignals")),
    riskSeverity: properties.get("ohrisk:riskSeverity") ?? null,
    action: properties.get("ohrisk:action") ?? null
  };
}

function propertyMap(value) {
  if (!Array.isArray(value)) return new Map();
  const entries = [];
  for (const property of value) {
    if (isObject(property) && typeof property.name === "string" && typeof property.value === "string") {
      entries.push([property.name, property.value]);
    }
  }
  return new Map(entries);
}

function renderLicense(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const expressions = [];
  const choices = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    if (typeof entry.expression === "string" && entry.expression !== "") {
      expressions.push(entry.expression);
      continue;
    }
    if (isObject(entry.license)) {
      const candidate = typeof entry.license.id === "string"
        ? entry.license.id
        : typeof entry.license.name === "string"
          ? entry.license.name
          : undefined;
      if (candidate) choices.push(candidate);
    }
  }
  if (expressions.length > 0) return uniqueSorted(expressions).join(" AND ");
  if (choices.length > 0) return uniqueSorted(choices).join(" OR ");
  return null;
}

function readEvidenceManifest(filePath) {
  const parsed = readJson(filePath, "notices evidence manifest");
  if (
    !isObject(parsed)
    || parsed.$schema !== EVIDENCE_SCHEMA
    || !Array.isArray(parsed.packages)
  ) {
    throw new Error("input is not an Ohrisk notices evidence manifest.");
  }
  const packages = parsed.packages.map((entry) => normalizeEvidenceEntry(entry));
  const purls = new Set();
  for (const entry of packages) {
    if (purls.has(entry.purl)) {
      throw new Error(`duplicate notices evidence for ${entry.purl}.`);
    }
    purls.add(entry.purl);
  }
  return { packages: packages.sort((left, right) => left.purl.localeCompare(right.purl)) };
}

function normalizeEvidenceEntry(value) {
  if (!isObject(value) || typeof value.purl !== "string" || value.purl === "") {
    throw new Error("Every notices evidence entry must contain a non-empty purl.");
  }
  return {
    purl: value.purl,
    copyright: stringArray(value.copyright, "copyright"),
    licenseFiles: pathArray(value.licenseFiles, "licenseFiles"),
    noticeFiles: pathArray(value.noticeFiles, "noticeFiles")
  };
}

function stringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return uniqueSorted(value.map((entry) => entry.trim()));
}

function pathArray(value, label) {
  return stringArray(value, label).map((entry) => {
    rejectControlCharacters(entry, label);
    if (path.isAbsolute(entry)) {
      throw new Error(`${label} entries must be workspace-relative paths.`);
    }
    return entry;
  });
}

function loadEvidenceDocument(input) {
  const filePath = resolveContainedFile(input.workspace, input.relativePath, "evidence path");
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${input.relativePath} must resolve to a regular file.`);
  }
  if (stats.size > MAX_EVIDENCE_FILE_BYTES) {
    throw new Error(`${input.relativePath} exceeds the 2 MiB legal-evidence limit.`);
  }
  const bytes = readFileSync(filePath);
  if (bytes.includes(0)) {
    throw new Error(`${input.relativePath} contains a NUL byte.`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(`${input.relativePath} is not valid UTF-8: ${errorMessage(cause)}`);
  }
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trimEnd();
  if (normalized === "") {
    throw new Error(`${input.relativePath} is empty.`);
  }
  const digest = sha256(normalized);
  const previous = input.documentByDigest.get(digest);
  if (previous && previous.text !== normalized) {
    throw new Error(`SHA-256 collision while loading ${input.relativePath}.`);
  }
  if (previous) {
    previous.packages.add(input.component.purl);
    previous.sourcePaths.add(input.relativePath.replaceAll("\\", "/"));
    previous.kinds.add(input.kind);
  } else {
    input.documentByDigest.set(digest, {
      digest,
      text: normalized,
      packages: new Set([input.component.purl]),
      sourcePaths: new Set([input.relativePath.replaceAll("\\", "/")]),
      kinds: new Set([input.kind])
    });
  }
  return { digest, fileCount: 1, byteCount: bytes.length };
}

function enforceEvidenceBudget(fileCount, byteCount) {
  if (fileCount > MAX_EVIDENCE_FILES) {
    throw new Error(`legal evidence exceeds the ${MAX_EVIDENCE_FILES}-file limit.`);
  }
  if (byteCount > MAX_TOTAL_EVIDENCE_BYTES) {
    throw new Error("legal evidence exceeds the 32 MiB total limit.");
  }
}

function renderNotices(input) {
  const projectName = isObject(input.sbom.metadata)
    && isObject(input.sbom.metadata.component)
    && typeof input.sbom.metadata.component.name === "string"
    ? input.sbom.metadata.component.name
    : "project";
  const lines = [
    "# THIRD_PARTY_NOTICES",
    "",
    `Project: ${escapeInline(projectName)}`,
    "",
    "Generated from an Ohrisk CycloneDX 1.5 report and explicitly supplied legal-evidence files. This document records evidence; it is not legal approval.",
    "",
    "## Package index",
    "",
    "| Package | Version | License | Scope | Direct | Legal documents |",
    "| --- | --- | --- | --- | --- | ---: |"
  ];

  for (const component of input.packages) {
    lines.push(
      `| ${escapeCell(component.name)} | ${escapeCell(component.version)} | ${escapeCell(component.license ?? "MISSING")} | ${escapeCell(component.scope)} | ${component.direct ? "yes" : "no"} | ${component.licenseDocuments.length + component.noticeDocuments.length} |`
    );
  }

  for (const component of input.packages) {
    lines.push(
      "",
      `## ${escapeHeading(component.name)} ${escapeHeading(component.version)}`,
      "",
      `Package URL: \`${escapeCode(component.purl)}\``,
      "",
      `Declared license: ${component.license ? `\`${escapeCode(component.license)}\`` : "MISSING"}`,
      "",
      `Dependency: ${escapeInline(component.dependencyType)}${component.direct ? ", direct" : ", transitive"}`
    );
    if (component.riskSeverity) {
      lines.push("", `Ohrisk risk: ${escapeInline(component.riskSeverity)}`);
    }
    if (component.action) {
      lines.push("", `Ohrisk action: ${escapeInline(component.action)}`);
    }
    if (component.copyright.length > 0) {
      lines.push("", "Copyright:", "", ...component.copyright.map((line) => `    ${line}`));
    }
    if (component.licenseDocuments.length > 0) {
      lines.push(
        "",
        `License documents: ${component.licenseDocuments.map((digest) => `\`${digest}\``).join(", ")}`
      );
    }
    if (component.noticeDocuments.length > 0) {
      lines.push(
        "",
        `Notice documents: ${component.noticeDocuments.map((digest) => `\`${digest}\``).join(", ")}`
      );
    }
  }

  lines.push("", "## Deduplicated legal documents");
  if (input.documents.length === 0) {
    lines.push("", "No legal document text was supplied.");
  }
  for (const document of input.documents) {
    lines.push(
      "",
      `### SHA-256 ${document.digest}`,
      "",
      `Kinds: ${[...document.kinds].sort().join(", ")}`,
      "",
      `Packages: ${[...document.packages].sort().map((purl) => `\`${escapeCode(purl)}\``).join(", ")}`,
      "",
      `Sources: ${[...document.sourcePaths].sort().map((source) => `\`${escapeCode(source)}\``).join(", ")}`,
      "",
      ...indentText(document.text)
    );
  }

  lines.push("", "## Incomplete evidence");
  if (input.incompletePackages.length === 0) {
    lines.push("", "All included packages have a license declaration and required legal files.");
  } else {
    lines.push(
      "",
      "| Package URL | Missing |",
      "| --- | --- |",
      ...input.incompletePackages.map((component) =>
        `| ${escapeCell(component.purl)} | ${component.missing.map(escapeCell).join(", ")} |`
      )
    );
  }

  lines.push("", "## Unused evidence entries");
  if (input.unusedEvidence.length === 0) {
    lines.push("", "None.");
  } else {
    lines.push("", ...input.unusedEvidence.map((purl) => `* \`${escapeCode(purl)}\``));
  }

  return lines.join("\n");
}

function parseArguments(argv) {
  const options = {
    allowIncomplete: false,
    includeExcluded: false,
    json: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--workspace":
        options.workspace = nextValue(argv, ++index, argument);
        break;
      case "--sbom":
        options.sbom = nextValue(argv, ++index, argument);
        break;
      case "--evidence":
        options.evidence = nextValue(argv, ++index, argument);
        break;
      case "--output":
        options.output = nextValue(argv, ++index, argument);
        break;
      case "--allow-incomplete":
        options.allowIncomplete = true;
        break;
      case "--include-excluded":
        options.includeExcluded = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown option ${JSON.stringify(argument)}. Run ohrisk-notices --help.`);
    }
  }
  if (!options.help && !options.sbom) {
    throw new Error("--sbom is required.");
  }
  return options;
}

function resolveWorkspace(value) {
  rejectControlCharacters(value ?? process.cwd(), "workspace path");
  return realpathSync(path.resolve(process.cwd(), value ?? "."));
}

function resolveContainedFile(workspace, value, label) {
  if (!value) throw new Error(`${label} is required.`);
  rejectControlCharacters(value, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be workspace-relative.`);
  }
  const candidate = realpathSync(path.resolve(workspace, value));
  requireContained(workspace, candidate, label);
  if (!lstatSync(candidate).isFile()) {
    throw new Error(`${label} must resolve to a regular file.`);
  }
  return candidate;
}

function resolveContainedOutput(workspace, value, label) {
  rejectControlCharacters(value, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be workspace-relative.`);
  }
  const candidate = path.resolve(workspace, value);
  requireContained(workspace, candidate, label);
  let ancestor = path.dirname(candidate);
  while (true) {
    try {
      ancestor = realpathSync(ancestor);
      break;
    } catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error(`${label} has no resolvable parent.`);
      ancestor = parent;
    }
  }
  requireContained(workspace, ancestor, label);
  return candidate;
}

function requireContained(workspace, candidate, label) {
  const relative = path.relative(workspace, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must resolve inside --workspace.`);
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read ${label}: ${errorMessage(cause)}`);
  }
}

function writeTextAtomically(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function rejectDuplicateComponents(components) {
  const purls = new Set();
  for (const component of components) {
    if (purls.has(component.purl)) {
      throw new Error(`duplicate CycloneDX component ${component.purl}.`);
    }
    purls.add(component.purl);
  }
}

function splitSignals(value) {
  return typeof value === "string" && value !== ""
    ? uniqueSorted(value.split(",").filter(Boolean))
    : [];
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function indentText(value) {
  return value.split("\n").map((line) => `    ${line}`);
}

function escapeInline(value) {
  return String(value)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeCell(value) {
  return escapeInline(value).replaceAll("|", "\\|");
}

function escapeHeading(value) {
  return escapeInline(value).replace(/^#+\s*/, "");
}

function escapeCode(value) {
  return String(value).replaceAll("`", "\\`").replace(/[\r\n]+/g, " ");
}

function displayPath(workspace, filePath) {
  return path.relative(workspace, filePath).replaceAll("\\", "/") || ".";
}

function nextValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function rejectControlCharacters(value, label) {
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${label} must not contain control characters.`);
  }
}

function renderHelp() {
  return [
    "Usage:",
    "  ohrisk-notices --sbom <ohrisk.cdx.json> [--evidence <notices-evidence.json>] [--output <file>]",
    "",
    "Generate a deterministic THIRD_PARTY_NOTICES document from Ohrisk CycloneDX data.",
    "Missing declarations or required legal files are listed and fail with exit code 1.",
    "Use --allow-incomplete only when an incomplete artifact is intentionally acceptable.",
    "Development-scope components are excluded unless --include-excluded is set."
  ].join("\n");
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
