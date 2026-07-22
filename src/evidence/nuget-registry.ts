import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

const NUGET_ORG_HOST = "api.nuget.org";
const SHA512_DIGEST_BYTES = 64;

export type NugetServiceEndpoints = {
  packageBaseUrl: string;
  registrationsBaseUrl: string;
};

export type NugetRegistrationLeaf = {
  catalogUrl: string;
  packageContentUrl: string;
};

export type NugetRegistrationLookup =
  | { kind: "leaf"; leaf: NugetRegistrationLeaf }
  | { kind: "page"; pageUrl: string };

export type NugetCatalogPackage = {
  packageHash: string;
  packageSize: number;
};

export function parseNugetServiceIndex(input: {
  packageId: string;
  text: string;
}): Result<NugetServiceEndpoints, OhriskError> {
  const document = parseJsonRecord(input, "NuGet service index");
  if (!document.ok) {
    return document;
  }
  if (!Array.isArray(document.value.resources)) {
    return err(nugetMetadataError(input, "NuGet service index did not contain a resources array."));
  }

  const packageBaseUrl = findServiceResource(
    document.value.resources,
    ["PackageBaseAddress/3.0.0"]
  );
  const registrationsBaseUrl = findServiceResource(
    document.value.resources,
    ["RegistrationsBaseUrl/3.6.0"]
  );
  if (!packageBaseUrl || !registrationsBaseUrl) {
    return err(nugetMetadataError(input, "NuGet service index did not expose the required V3 resources.", {
      reason: "required_service_resource_missing"
    }));
  }

  const packageBase = validateNugetOrgUrl(packageBaseUrl, "service_package_base", true);
  const registrationsBase = validateNugetOrgUrl(
    registrationsBaseUrl,
    "service_registrations_base",
    true
  );
  if (!packageBase.ok) {
    return err(nugetMetadataError(input, packageBase.message, packageBase.details));
  }
  if (!registrationsBase.ok) {
    return err(nugetMetadataError(input, registrationsBase.message, registrationsBase.details));
  }

  return ok({
    packageBaseUrl: packageBase.url,
    registrationsBaseUrl: registrationsBase.url
  });
}

export function parseNugetPackageVersions(input: {
  packageId: string;
  packageName: string;
  requestedVersion: string;
  text: string;
}): Result<string, OhriskError> {
  const document = parseJsonRecord(input, "NuGet package version index");
  if (!document.ok) {
    return document;
  }
  if (!Array.isArray(document.value.versions)) {
    return err(nugetMetadataError(input, "NuGet package version index did not contain a versions array."));
  }

  const requested = normalizeNugetVersion(input.requestedVersion);
  if (!requested) {
    return err(nugetMetadataError(input, "NuGet dependency version was not a safe exact version.", {
      reason: "unsafe_exact_version",
      requestedVersion: input.requestedVersion
    }));
  }

  const matches = document.value.versions
    .filter((value): value is string => typeof value === "string")
    .filter((value) => normalizeNugetVersion(value) === requested);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) {
    return err(nugetMetadataError(input, "NuGet package version index did not identify exactly one requested version.", {
      reason: unique.length === 0 ? "version_not_found" : "version_ambiguous",
      requestedVersion: input.requestedVersion,
      matchCount: unique.length
    }));
  }
  return ok(unique[0] as string);
}

export function parseNugetRegistrationIndex(input: {
  packageId: string;
  packageName: string;
  normalizedVersion: string;
  expectedPackageContentUrl: string;
  text: string;
}): Result<NugetRegistrationLookup, OhriskError> {
  const document = parseJsonRecord(input, "NuGet registration index");
  if (!document.ok) {
    return document;
  }
  if (!Array.isArray(document.value.items)) {
    return err(nugetMetadataError(input, "NuGet registration index did not contain registration pages."));
  }

  for (const page of document.value.items) {
    if (!isRecord(page)) {
      continue;
    }
    if (Array.isArray(page.items)) {
      const leaf = findRegistrationLeaf(input, page.items);
      if (!leaf.ok || leaf.value) {
        return leaf.ok ? ok({ kind: "leaf", leaf: leaf.value as NugetRegistrationLeaf }) : leaf;
      }
      continue;
    }
    if (!registrationPageContainsVersion(page, input.normalizedVersion)) {
      continue;
    }
    const pageUrl = typeof page["@id"] === "string" ? page["@id"] : undefined;
    const validated = pageUrl
      ? validateNugetOrgUrl(pageUrl, "registration_page", false)
      : { ok: false as const, message: "NuGet registration page did not include a safe URL.", details: { reason: "registration_page_url_missing" } };
    if (!validated.ok) {
      return err(nugetMetadataError(input, validated.message, validated.details));
    }
    return ok({ kind: "page", pageUrl: validated.url });
  }

  return err(nugetMetadataError(input, "NuGet registration index did not contain the requested package version.", {
    reason: "registration_version_not_found",
    normalizedVersion: input.normalizedVersion
  }));
}

export function parseNugetRegistrationPage(input: {
  packageId: string;
  packageName: string;
  normalizedVersion: string;
  expectedPackageContentUrl: string;
  text: string;
}): Result<NugetRegistrationLeaf, OhriskError> {
  const document = parseJsonRecord(input, "NuGet registration page");
  if (!document.ok) {
    return document;
  }
  if (!Array.isArray(document.value.items)) {
    return err(nugetMetadataError(input, "NuGet registration page did not contain registration leaves."));
  }
  const leaf = findRegistrationLeaf(input, document.value.items);
  if (!leaf.ok) {
    return leaf;
  }
  if (!leaf.value) {
    return err(nugetMetadataError(input, "NuGet registration page did not contain the requested package version.", {
      reason: "registration_version_not_found",
      normalizedVersion: input.normalizedVersion
    }));
  }
  return ok(leaf.value);
}

export function parseNugetCatalogPackage(input: {
  packageId: string;
  packageName: string;
  normalizedVersion: string;
  text: string;
}): Result<NugetCatalogPackage, OhriskError> {
  const document = parseJsonRecord(input, "NuGet catalog leaf");
  if (!document.ok) {
    return document;
  }
  const id = document.value.id;
  const version = document.value.version;
  const packageHash = document.value.packageHash;
  const packageHashAlgorithm = document.value.packageHashAlgorithm;
  const packageSize = document.value.packageSize;
  const digest = typeof packageHash === "string" ? decodeCanonicalBase64(packageHash) : undefined;

  if (
    typeof id !== "string"
    || id.toLowerCase() !== input.packageName.toLowerCase()
    || typeof version !== "string"
    || normalizeNugetVersion(version) !== input.normalizedVersion
  ) {
    return err(nugetMetadataError(input, "NuGet catalog leaf identity did not match the requested package.", {
      reason: "catalog_identity_mismatch",
      ...(typeof id === "string" ? { observedName: id } : {}),
      ...(typeof version === "string" ? { observedVersion: version } : {})
    }));
  }
  if (
    typeof packageHashAlgorithm !== "string"
    || packageHashAlgorithm.toUpperCase() !== "SHA512"
    || !digest
    || digest.length !== SHA512_DIGEST_BYTES
  ) {
    return err(nugetMetadataError(input, "NuGet catalog leaf did not contain a valid SHA-512 package hash.", {
      reason: "catalog_hash_invalid",
      ...(typeof packageHashAlgorithm === "string" ? { packageHashAlgorithm } : {})
    }));
  }
  if (!Number.isSafeInteger(packageSize) || (packageSize as number) <= 0) {
    return err(nugetMetadataError(input, "NuGet catalog leaf did not contain a valid package size.", {
      reason: "catalog_package_size_invalid"
    }));
  }
  return ok({ packageHash: packageHash as string, packageSize: packageSize as number });
}

export function normalizeNugetVersion(value: string): string | undefined {
  if (value.length === 0 || value.length > 256) {
    return undefined;
  }
  const match = value.trim().match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
  );
  if (!match) {
    return undefined;
  }
  const numeric = [match[1], match[2] ?? "0", match[3] ?? "0", match[4] ?? "0"]
    .map((part) => BigInt(part as string).toString());
  const core = numeric[3] === "0" ? numeric.slice(0, 3) : numeric;
  const prerelease = match[5]
    ?.split(".")
    .map((part) => /^\d+$/u.test(part) ? BigInt(part).toString() : part.toLowerCase())
    .join(".");
  return `${core.join(".")}${prerelease ? `-${prerelease}` : ""}`.toLowerCase();
}

function findRegistrationLeaf(
  input: {
    packageId: string;
    packageName: string;
    normalizedVersion: string;
    expectedPackageContentUrl: string;
  },
  items: unknown[]
): Result<NugetRegistrationLeaf | undefined, OhriskError> {
  const matches = items.filter((item) => {
    if (!isRecord(item) || !isRecord(item.catalogEntry)) {
      return false;
    }
    return typeof item.catalogEntry.id === "string"
      && item.catalogEntry.id.toLowerCase() === input.packageName.toLowerCase()
      && typeof item.catalogEntry.version === "string"
      && normalizeNugetVersion(item.catalogEntry.version) === input.normalizedVersion;
  });
  if (matches.length > 1) {
    return err(nugetMetadataError(input, "NuGet registration metadata contained duplicate package versions.", {
      reason: "registration_version_ambiguous",
      matchCount: matches.length
    }));
  }
  const item = matches[0];
  if (!isRecord(item) || !isRecord(item.catalogEntry)) {
    return ok(undefined);
  }

  const catalogUrl = typeof item.catalogEntry["@id"] === "string"
    ? item.catalogEntry["@id"]
    : undefined;
  const packageContentUrl = typeof item.packageContent === "string"
    ? item.packageContent
    : undefined;
  const validatedCatalog = catalogUrl
    ? validateNugetOrgUrl(catalogUrl, "catalog_leaf", false)
    : { ok: false as const, message: "NuGet registration leaf did not include a catalog URL.", details: { reason: "catalog_url_missing" } };
  if (!validatedCatalog.ok) {
    return err(nugetMetadataError(input, validatedCatalog.message, validatedCatalog.details));
  }
  const validatedContent = packageContentUrl
    ? validateNugetOrgUrl(packageContentUrl, "package_content", false)
    : { ok: false as const, message: "NuGet registration leaf did not include a package content URL.", details: { reason: "package_content_url_missing" } };
  if (!validatedContent.ok) {
    return err(nugetMetadataError(input, validatedContent.message, validatedContent.details));
  }
  if (validatedContent.url !== input.expectedPackageContentUrl) {
    return err(nugetMetadataError(input, "NuGet registration package URL did not match the discovered flat-container URL.", {
      reason: "package_content_url_mismatch",
      expectedPackageContentUrl: input.expectedPackageContentUrl,
      observedPackageContentUrl: validatedContent.url
    }));
  }
  return ok({
    catalogUrl: validatedCatalog.url,
    packageContentUrl: validatedContent.url
  });
}

function registrationPageContainsVersion(page: Record<string, unknown>, version: string): boolean {
  const lower = typeof page.lower === "string" ? normalizeNugetVersion(page.lower) : undefined;
  const upper = typeof page.upper === "string" ? normalizeNugetVersion(page.upper) : undefined;
  if (!lower || !upper) {
    return false;
  }
  return compareNugetVersions(lower, version) <= 0 && compareNugetVersions(version, upper) <= 0;
}

function compareNugetVersions(left: string, right: string): number {
  const parsedLeft = splitNormalizedVersion(left);
  const parsedRight = splitNormalizedVersion(right);
  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right);
  }
  for (let index = 0; index < 4; index += 1) {
    const leftPart = parsedLeft.numeric[index] ?? 0n;
    const rightPart = parsedRight.numeric[index] ?? 0n;
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  if (!parsedLeft.prerelease && !parsedRight.prerelease) return 0;
  if (!parsedLeft.prerelease) return 1;
  if (!parsedRight.prerelease) return -1;
  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = parsedLeft.prerelease[index];
    const rightPart = parsedRight.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function splitNormalizedVersion(value: string): {
  numeric: bigint[];
  prerelease?: string[];
} | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?$/u);
  if (!match) return undefined;
  return {
    numeric: [match[1], match[2], match[3], match[4] ?? "0"].map((part) => BigInt(part as string)),
    ...(match[5] ? { prerelease: match[5].split(".") } : {})
  };
}

function findServiceResource(resources: unknown[], acceptedTypes: string[]): string | undefined {
  for (const resource of resources) {
    if (!isRecord(resource) || typeof resource["@id"] !== "string") continue;
    const types = Array.isArray(resource["@type"])
      ? resource["@type"]
      : [resource["@type"]];
    if (types.some((type) => typeof type === "string" && acceptedTypes.includes(type))) {
      return resource["@id"];
    }
  }
  return undefined;
}

function validateNugetOrgUrl(
  value: string,
  usage: string,
  requireTrailingSlash: boolean
): { ok: true; url: string } | { ok: false; message: string; details: Record<string, unknown> } {
  try {
    const url = new URL(value);
    const supportedPath = url.pathname.startsWith("/v3/")
      || (
        (usage === "service_package_base" || usage === "package_content")
        && url.pathname.startsWith("/v3-flatcontainer/")
      );
    if (
      url.protocol !== "https:"
      || url.hostname.toLowerCase() !== NUGET_ORG_HOST
      || url.port !== ""
      || url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== ""
      || !supportedPath
      || (requireTrailingSlash && !url.pathname.endsWith("/"))
    ) {
      return { ok: false, message: "NuGet service metadata included an unsupported URL.", details: { reason: "unsupported_nuget_url", usage } };
    }
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, message: "NuGet service metadata included a malformed URL.", details: { reason: "malformed_nuget_url", usage } };
  }
}

function decodeCanonicalBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
    return undefined;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : undefined;
}

function parseJsonRecord(
  input: { packageId: string; text: string },
  label: string
): Result<Record<string, unknown>, OhriskError> {
  try {
    const document = JSON.parse(input.text) as unknown;
    return isRecord(document)
      ? ok(document)
      : err(nugetMetadataError(input, `${label} was not a JSON object.`));
  } catch (cause) {
    return err(nugetMetadataError(input, `${label} was not valid JSON.`, {
      cause: cause instanceof Error ? cause.message : String(cause)
    }));
  }
}

function nugetMetadataError(
  input: { packageId: string; packageName?: string },
  message: string,
  details: Record<string, unknown> = {}
): OhriskError {
  return createError({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    category: "unsupported_input",
    message,
    details: {
      packageId: input.packageId,
      ...(input.packageName ? { packageName: input.packageName } : {}),
      ...details
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
