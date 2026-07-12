import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { USAGE_PROFILES, type UsageProfile } from "./profiles";
import type { RiskRecommendation, RiskSeverity } from "./types";

const POLICY_FILENAME = ".ohrisk.yml";
const POLICY_VERSION = 1;
const POLICY_MAX_BYTES = 1024 * 1024;
const POLICY_MAX_INHERITANCE_DEPTH = 8;
const RISK_SEVERITIES = new Set<RiskSeverity>(["low", "review", "high", "unknown"]);
const RISK_RECOMMENDATIONS = new Set<RiskRecommendation>([
  "allow",
  "review",
  "replace",
  "exclude-dev-only",
  "collect-evidence"
]);
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type PackagePolicyRule = {
  severity?: RiskSeverity;
  reason?: string;
  action?: string;
  recommendation?: RiskRecommendation;
};

export type RegistryAuthPolicy = {
  tokenEnv: string;
};

export type EvaluationPolicy = {
  allowLicenses: Set<string>;
  denyLicenses: Set<string>;
  severityOverrides: Map<string, RiskSeverity>;
  packageRules: Map<string, PackagePolicyRule>;
  profileOverrides?: ReadonlyMap<UsageProfile, EvaluationPolicy>;
};

export type ResolvedPolicyConfig = EvaluationPolicy & {
  profileOverrides: Map<UsageProfile, EvaluationPolicy>;
  sourceFiles: string[];
  allowedRegistryHosts: Set<string>;
  registryAuth: Map<string, RegistryAuthPolicy>;
  npmRegistryUrl?: string;
};

export type PolicyConfigSummary = {
  enabled: boolean;
  sourceFiles: string[];
  allowLicenseCount: number;
  denyLicenseCount: number;
  severityOverrideCount: number;
  packageRuleCount: number;
  profileCount: number;
  profileOverrideCount: number;
  allowedRegistryHostCount: number;
  registryAuthHostCount: number;
  npmRegistryUrl?: string;
};

export function emptyPolicyConfig(): ResolvedPolicyConfig {
  return {
    sourceFiles: [],
    allowLicenses: new Set(),
    denyLicenses: new Set(),
    severityOverrides: new Map(),
    packageRules: new Map(),
    profileOverrides: new Map(),
    allowedRegistryHosts: new Set(),
    registryAuth: new Map()
  };
}

export function summarizePolicyConfig(config: ResolvedPolicyConfig): PolicyConfigSummary {
  return {
    enabled: config.sourceFiles.length > 0,
    sourceFiles: [...config.sourceFiles],
    allowLicenseCount: config.allowLicenses.size,
    denyLicenseCount: config.denyLicenses.size,
    severityOverrideCount: config.severityOverrides.size,
    packageRuleCount: config.packageRules.size,
    profileCount: config.profileOverrides.size,
    profileOverrideCount: [...config.profileOverrides.values()].reduce(
      (count, profile) => count + policyEntryCount(profile),
      0
    ),
    allowedRegistryHostCount: config.allowedRegistryHosts.size,
    registryAuthHostCount: config.registryAuth.size,
    ...(config.npmRegistryUrl ? { npmRegistryUrl: redactRegistryUrl(config.npmRegistryUrl) } : {})
  };
}

export function evaluationPolicyForProfile(
  policy: EvaluationPolicy,
  profile: UsageProfile
): EvaluationPolicy {
  const override = policy.profileOverrides?.get(profile);
  if (!override) {
    return policy;
  }

  return mergeEvaluationPolicies(policy, override);
}

export function readPolicyConfig(input: {
  projectRoot: string;
  workspaceRoot?: string;
  policyPath?: string;
}): Result<ResolvedPolicyConfig, OhriskError> {
  const boundaryRoot = realDirectory(input.workspaceRoot ?? input.projectRoot);
  if (!boundaryRoot.ok) {
    return boundaryRoot;
  }

  const requestedPath = input.policyPath
    ? path.resolve(input.projectRoot, input.policyPath)
    : path.join(input.projectRoot, POLICY_FILENAME);

  if (!existsSync(requestedPath)) {
    if (input.policyPath) {
      return err(policyReadError({
        message: "Explicit policy file does not exist.",
        filePath: requestedPath
      }));
    }
    return ok(emptyPolicyConfig());
  }

  return readPolicyFile({
    filePath: requestedPath,
    boundaryRoot: boundaryRoot.value,
    visited: new Set(),
    depth: 0
  });
}

export function matchPolicyPackageRule(
  packageIdentifiers: string | readonly string[],
  packageRules: ReadonlyMap<string, PackagePolicyRule>
): PackagePolicyRule | undefined {
  const identifiers = typeof packageIdentifiers === "string"
    ? [packageIdentifiers]
    : [...packageIdentifiers];

  for (const identifier of identifiers) {
    const exact = packageRules.get(identifier);
    if (exact) {
      return exact;
    }
  }

  let bestMatch: { pattern: string; rule: PackagePolicyRule } | undefined;
  for (const [pattern, rule] of packageRules) {
    if (!pattern.includes("*")) {
      continue;
    }
    if (!identifiers.some((identifier) => globMatches(pattern, identifier))) {
      continue;
    }
    if (!bestMatch || pattern.length > bestMatch.pattern.length) {
      bestMatch = { pattern, rule };
    }
  }
  return bestMatch?.rule;
}

function readPolicyFile(input: {
  filePath: string;
  boundaryRoot: string;
  visited: Set<string>;
  depth: number;
}): Result<ResolvedPolicyConfig, OhriskError> {
  if (input.depth > POLICY_MAX_INHERITANCE_DEPTH) {
    return err(policyParseError({
      message: "Policy inheritance exceeded the supported depth.",
      filePath: input.filePath,
      details: { maxDepth: POLICY_MAX_INHERITANCE_DEPTH }
    }));
  }

  const trustedPath = trustedPolicyPath(input.filePath, input.boundaryRoot);
  if (!trustedPath.ok) {
    return trustedPath;
  }
  if (input.visited.has(trustedPath.value)) {
    return err(policyParseError({
      message: "Policy inheritance contains a cycle.",
      filePath: trustedPath.value
    }));
  }

  const text = readPolicyText(trustedPath.value);
  if (!text.ok) {
    return text;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text.value);
  } catch (cause) {
    return err(policyParseError({
      message: "Policy file is not valid YAML.",
      filePath: trustedPath.value,
      details: { cause: errorMessage(cause) }
    }));
  }

  const document = parsePolicyDocument(parsed, trustedPath.value);
  if (!document.ok) {
    return document;
  }

  const nextVisited = new Set(input.visited);
  nextVisited.add(trustedPath.value);
  let resolved = emptyPolicyConfig();
  for (const inheritedPath of document.value.extends) {
    if (isRemoteReference(inheritedPath)) {
      return err(policyParseError({
        message: "Policy inheritance accepts local files only.",
        filePath: trustedPath.value,
        details: { inheritedPath }
      }));
    }
    const inherited = readPolicyFile({
      filePath: path.resolve(path.dirname(trustedPath.value), inheritedPath),
      boundaryRoot: input.boundaryRoot,
      visited: nextVisited,
      depth: input.depth + 1
    });
    if (!inherited.ok) {
      return inherited;
    }
    resolved = mergePolicyConfigs(resolved, inherited.value);
  }

  const current = policyConfigFromDocument(document.value, {
    boundaryRoot: input.boundaryRoot,
    filePath: trustedPath.value
  });
  if (!current.ok) {
    return current;
  }

  const merged = mergePolicyConfigs(resolved, current.value);
  const conflict = findPolicyConflict(merged);
  if (conflict) {
    return err(policyParseError({
      message: "The same license cannot appear in both licenses.allow and licenses.deny.",
      filePath: trustedPath.value,
      details: conflict
    }));
  }
  return ok(merged);
}

type ParsedPolicyDocument = {
  extends: string[];
  licenses: {
    allow: string[];
    deny: string[];
    severity: Record<string, RiskSeverity>;
  };
  packages: Record<string, PackagePolicyRule>;
  profiles: Map<UsageProfile, EvaluationPolicy>;
  network: {
    allowedHosts: string[];
    auth: Record<string, RegistryAuthPolicy>;
    npmRegistryUrl?: string;
  };
};

function parsePolicyDocument(
  value: unknown,
  filePath: string
): Result<ParsedPolicyDocument, OhriskError> {
  if (!isRecord(value)) {
    return err(policyParseError({
      message: "Policy root must be a YAML object.",
      filePath
    }));
  }
  if (value.version !== POLICY_VERSION) {
    return err(policyParseError({
      message: `Policy version must be ${POLICY_VERSION}.`,
      filePath,
      details: { version: value.version }
    }));
  }

  const extendsPaths = readStringList(value.extends, "extends", filePath, true);
  if (!extendsPaths.ok) return extendsPaths;

  const licenses = value.licenses === undefined ? {} : value.licenses;
  if (!isRecord(licenses)) {
    return err(policyParseError({ message: "licenses must be a YAML object.", filePath }));
  }
  const allow = readStringList(licenses.allow, "licenses.allow", filePath);
  if (!allow.ok) return allow;
  const deny = readStringList(licenses.deny, "licenses.deny", filePath);
  if (!deny.ok) return deny;
  const severity = readSeverityOverrides(licenses.severity, filePath);
  if (!severity.ok) return severity;

  const packages = readPackageRules(value.packages, filePath);
  if (!packages.ok) return packages;
  const profiles = readProfilePolicies(value.profiles, filePath);
  if (!profiles.ok) return profiles;

  const network = value.network === undefined ? {} : value.network;
  if (!isRecord(network)) {
    return err(policyParseError({ message: "network must be a YAML object.", filePath }));
  }
  const allowedHosts = readStringList(network.allowedHosts, "network.allowedHosts", filePath);
  if (!allowedHosts.ok) return allowedHosts;
  const auth = readRegistryAuth(network.auth, filePath);
  if (!auth.ok) return auth;
  const npmRegistryUrl = readOptionalRegistryUrl(network.npmRegistryUrl, filePath);
  if (!npmRegistryUrl.ok) return npmRegistryUrl;

  return ok({
    extends: extendsPaths.value,
    licenses: {
      allow: allow.value,
      deny: deny.value,
      severity: severity.value
    },
    packages: packages.value,
    profiles: profiles.value,
    network: {
      allowedHosts: allowedHosts.value,
      auth: auth.value,
      ...(npmRegistryUrl.value ? { npmRegistryUrl: npmRegistryUrl.value } : {})
    }
  });
}

function policyConfigFromDocument(
  document: ParsedPolicyDocument,
  input: { boundaryRoot: string; filePath: string }
): Result<ResolvedPolicyConfig, OhriskError> {
  const allowedRegistryHosts = new Set<string>();
  for (const host of document.network.allowedHosts) {
    const normalized = normalizeHostname(host);
    if (!normalized) {
      return err(policyParseError({
        message: "network.allowedHosts contains an invalid hostname.",
        filePath: input.filePath,
        details: { host }
      }));
    }
    allowedRegistryHosts.add(normalized);
  }

  if (document.network.npmRegistryUrl) {
    const registryHost = new URL(document.network.npmRegistryUrl).hostname.toLowerCase();
    allowedRegistryHosts.add(registryHost);
  }

  const registryAuth = new Map<string, RegistryAuthPolicy>();
  for (const [host, auth] of Object.entries(document.network.auth)) {
    const normalized = normalizeHostname(host);
    if (!normalized) {
      return err(policyParseError({
        message: "network.auth contains an invalid hostname.",
        filePath: input.filePath,
        details: { host }
      }));
    }
    if (!allowedRegistryHosts.has(normalized)) {
      return err(policyParseError({
        message: "Authenticated registry hosts must also be listed in network.allowedHosts or used by network.npmRegistryUrl.",
        filePath: input.filePath,
        details: { host: normalized }
      }));
    }
    registryAuth.set(normalized, auth);
  }

  return ok({
    sourceFiles: [safeRelativePath(input.boundaryRoot, input.filePath)],
    allowLicenses: new Set(document.licenses.allow),
    denyLicenses: new Set(document.licenses.deny),
    severityOverrides: new Map(Object.entries(document.licenses.severity)),
    packageRules: new Map(Object.entries(document.packages)),
    profileOverrides: document.profiles,
    allowedRegistryHosts,
    registryAuth,
    ...(document.network.npmRegistryUrl
      ? { npmRegistryUrl: document.network.npmRegistryUrl }
      : {})
  });
}

function mergePolicyConfigs(
  parent: ResolvedPolicyConfig,
  child: ResolvedPolicyConfig
): ResolvedPolicyConfig {
  return {
    sourceFiles: unique([...parent.sourceFiles, ...child.sourceFiles]),
    allowLicenses: new Set([...parent.allowLicenses, ...child.allowLicenses]),
    denyLicenses: new Set([...parent.denyLicenses, ...child.denyLicenses]),
    severityOverrides: new Map([...parent.severityOverrides, ...child.severityOverrides]),
    packageRules: new Map([...parent.packageRules, ...child.packageRules]),
    profileOverrides: mergeProfileOverrides(parent.profileOverrides, child.profileOverrides),
    allowedRegistryHosts: new Set([
      ...parent.allowedRegistryHosts,
      ...child.allowedRegistryHosts
    ]),
    registryAuth: new Map([...parent.registryAuth, ...child.registryAuth]),
    ...(child.npmRegistryUrl
      ? { npmRegistryUrl: child.npmRegistryUrl }
      : parent.npmRegistryUrl
        ? { npmRegistryUrl: parent.npmRegistryUrl }
        : {})
  };
}

function mergeEvaluationPolicies(
  parent: EvaluationPolicy,
  child: EvaluationPolicy
): EvaluationPolicy {
  return {
    allowLicenses: new Set([...parent.allowLicenses, ...child.allowLicenses]),
    denyLicenses: new Set([...parent.denyLicenses, ...child.denyLicenses]),
    severityOverrides: new Map([...parent.severityOverrides, ...child.severityOverrides]),
    packageRules: new Map([...parent.packageRules, ...child.packageRules])
  };
}

function mergeProfileOverrides(
  parent: ReadonlyMap<UsageProfile, EvaluationPolicy>,
  child: ReadonlyMap<UsageProfile, EvaluationPolicy>
): Map<UsageProfile, EvaluationPolicy> {
  const merged = new Map<UsageProfile, EvaluationPolicy>();
  for (const profile of USAGE_PROFILES) {
    const parentPolicy = parent.get(profile);
    const childPolicy = child.get(profile);
    if (parentPolicy && childPolicy) {
      merged.set(profile, mergeEvaluationPolicies(parentPolicy, childPolicy));
    } else if (childPolicy) {
      merged.set(profile, childPolicy);
    } else if (parentPolicy) {
      merged.set(profile, parentPolicy);
    }
  }
  return merged;
}

function findPolicyConflict(
  policy: ResolvedPolicyConfig
): Record<string, unknown> | undefined {
  const baseConflicts = conflictingLicenses(policy);
  if (baseConflicts.length > 0) {
    return { conflictingLicenses: baseConflicts };
  }

  for (const profile of USAGE_PROFILES) {
    const effective = evaluationPolicyForProfile(policy, profile);
    const conflicts = conflictingLicenses(effective);
    if (conflicts.length > 0) {
      return { profile, conflictingLicenses: conflicts };
    }
  }
  return undefined;
}

function conflictingLicenses(policy: EvaluationPolicy): string[] {
  return [...policy.allowLicenses]
    .filter((license) => policy.denyLicenses.has(license))
    .sort();
}

function policyEntryCount(policy: EvaluationPolicy): number {
  return policy.allowLicenses.size
    + policy.denyLicenses.size
    + policy.severityOverrides.size
    + policy.packageRules.size;
}

function readPolicyText(filePath: string): Result<string, OhriskError> {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return err(policyReadError({
        message: "Policy path must point to a regular file.",
        filePath
      }));
    }
    if (stats.size > POLICY_MAX_BYTES) {
      return err(policyReadError({
        message: "Policy file exceeded the maximum supported size.",
        filePath,
        details: { maxBytes: POLICY_MAX_BYTES, observedBytes: stats.size }
      }));
    }
    return ok(readFileSync(filePath, "utf8"));
  } catch (cause) {
    return err(policyReadError({
      message: "Could not read policy file.",
      filePath,
      details: { cause: errorMessage(cause) }
    }));
  }
}

function readProfilePolicies(
  value: unknown,
  filePath: string
): Result<Map<UsageProfile, EvaluationPolicy>, OhriskError> {
  if (value === undefined) {
    return ok(new Map());
  }
  if (!isRecord(value)) {
    return err(policyParseError({ message: "profiles must be a YAML object.", filePath }));
  }

  const supportedProfiles = new Set<string>(USAGE_PROFILES);
  const result = new Map<UsageProfile, EvaluationPolicy>();
  for (const [profileName, rawProfile] of Object.entries(value)) {
    if (!supportedProfiles.has(profileName) || !isRecord(rawProfile)) {
      return err(policyParseError({
        message: "profiles keys must be supported usage profiles with object values.",
        filePath,
        details: { profile: profileName, supportedProfiles: [...USAGE_PROFILES] }
      }));
    }

    const licenses = rawProfile.licenses === undefined ? {} : rawProfile.licenses;
    if (!isRecord(licenses)) {
      return err(policyParseError({
        message: `profiles.${profileName}.licenses must be a YAML object.`,
        filePath
      }));
    }
    const allow = readStringList(
      licenses.allow,
      `profiles.${profileName}.licenses.allow`,
      filePath
    );
    if (!allow.ok) return allow;
    const deny = readStringList(
      licenses.deny,
      `profiles.${profileName}.licenses.deny`,
      filePath
    );
    if (!deny.ok) return deny;
    const severity = readSeverityOverrides(
      licenses.severity,
      filePath,
      `profiles.${profileName}.licenses.severity`
    );
    if (!severity.ok) return severity;
    const packages = readPackageRules(
      rawProfile.packages,
      filePath,
      `profiles.${profileName}.packages`
    );
    if (!packages.ok) return packages;

    result.set(profileName as UsageProfile, {
      allowLicenses: new Set(allow.value),
      denyLicenses: new Set(deny.value),
      severityOverrides: new Map(Object.entries(severity.value)),
      packageRules: new Map(Object.entries(packages.value))
    });
  }
  return ok(result);
}

function readSeverityOverrides(
  value: unknown,
  filePath: string,
  field = "licenses.severity"
): Result<Record<string, RiskSeverity>, OhriskError> {
  if (value === undefined) return ok({});
  if (!isRecord(value)) {
    return err(policyParseError({
      message: `${field} must be a YAML object.`,
      filePath
    }));
  }
  const result: Record<string, RiskSeverity> = {};
  for (const [license, severity] of Object.entries(value)) {
    if (
      license.trim() === ""
      || typeof severity !== "string"
      || !RISK_SEVERITIES.has(severity as RiskSeverity)
    ) {
      return err(policyParseError({
        message: `${field} must map non-empty license expressions to valid severities.`,
        filePath,
        details: { license, severity }
      }));
    }
    result[license.trim()] = severity as RiskSeverity;
  }
  return ok(result);
}

function readPackageRules(
  value: unknown,
  filePath: string,
  field = "packages"
): Result<Record<string, PackagePolicyRule>, OhriskError> {
  if (value === undefined) return ok({});
  if (!isRecord(value)) {
    return err(policyParseError({ message: `${field} must be a YAML object.`, filePath }));
  }

  const result: Record<string, PackagePolicyRule> = {};
  for (const [packagePattern, rawRule] of Object.entries(value)) {
    if (packagePattern.trim() === "" || !isRecord(rawRule)) {
      return err(policyParseError({
        message: "Each packages entry must be an object keyed by a package ID, Package URL, or glob.",
        filePath,
        details: { packagePattern }
      }));
    }

    const severity = rawRule.severity;
    const recommendation = rawRule.recommendation;
    const reason = rawRule.reason;
    const action = rawRule.action;
    if (severity !== undefined && (
      typeof severity !== "string"
      || !RISK_SEVERITIES.has(severity as RiskSeverity)
    )) {
      return err(policyParseError({
        message: `${field}.*.severity must be a valid severity.`,
        filePath,
        details: { packagePattern, severity }
      }));
    }
    if (recommendation !== undefined && (
      typeof recommendation !== "string"
      || !RISK_RECOMMENDATIONS.has(recommendation as RiskRecommendation)
    )) {
      return err(policyParseError({
        message: `${field}.*.recommendation must be a valid recommendation.`,
        filePath,
        details: { packagePattern, recommendation }
      }));
    }
    if (reason !== undefined && (typeof reason !== "string" || reason.trim() === "")) {
      return err(policyParseError({
        message: `${field}.*.reason must be a non-empty string.`,
        filePath,
        details: { packagePattern }
      }));
    }
    if (action !== undefined && (typeof action !== "string" || action.trim() === "")) {
      return err(policyParseError({
        message: `${field}.*.action must be a non-empty string.`,
        filePath,
        details: { packagePattern }
      }));
    }

    const rule: PackagePolicyRule = {
      ...(severity !== undefined ? { severity: severity as RiskSeverity } : {}),
      ...(recommendation !== undefined
        ? { recommendation: recommendation as RiskRecommendation }
        : {}),
      ...(typeof reason === "string" ? { reason: reason.trim() } : {}),
      ...(typeof action === "string" ? { action: action.trim() } : {})
    };
    if (Object.keys(rule).length === 0) {
      return err(policyParseError({
        message: "Each packages entry must define at least one override.",
        filePath,
        details: { packagePattern }
      }));
    }
    result[packagePattern.trim()] = rule;
  }
  return ok(result);
}

function readRegistryAuth(
  value: unknown,
  filePath: string
): Result<Record<string, RegistryAuthPolicy>, OhriskError> {
  if (value === undefined) return ok({});
  if (!isRecord(value)) {
    return err(policyParseError({ message: "network.auth must be a YAML object.", filePath }));
  }
  const result: Record<string, RegistryAuthPolicy> = {};
  for (const [host, rawAuth] of Object.entries(value)) {
    if (
      !isRecord(rawAuth)
      || typeof rawAuth.tokenEnv !== "string"
      || !ENV_NAME_PATTERN.test(rawAuth.tokenEnv)
    ) {
      return err(policyParseError({
        message: "Each network.auth entry requires a valid tokenEnv environment variable name.",
        filePath,
        details: { host }
      }));
    }
    result[host] = { tokenEnv: rawAuth.tokenEnv };
  }
  return ok(result);
}

function readOptionalRegistryUrl(
  value: unknown,
  filePath: string
): Result<string | undefined, OhriskError> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "string") {
    return err(policyParseError({
      message: "network.npmRegistryUrl must be an HTTPS URL.",
      filePath
    }));
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !isAllowedRegistryHostname(host)
    ) {
      throw new Error("Registry URL must use HTTPS, target a DNS hostname, and omit credentials, query, and fragment data.");
    }
    return ok(parsed.toString().replace(/\/$/, ""));
  } catch (cause) {
    return err(policyParseError({
      message: "network.npmRegistryUrl must be an HTTPS URL without embedded credentials.",
      filePath,
      details: { cause: errorMessage(cause) }
    }));
  }
}

function readStringList(
  value: unknown,
  field: string,
  filePath: string,
  allowSingle = false
): Result<string[], OhriskError> {
  if (value === undefined) return ok([]);
  const items = allowSingle && typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(items)
    || items.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    return err(policyParseError({
      message: `${field} must be ${allowSingle ? "a string or " : ""}an array of non-empty strings.`,
      filePath
    }));
  }
  return ok(unique(items.map((item) => String(item).trim())));
}

function trustedPolicyPath(
  filePath: string,
  boundaryRoot: string
): Result<string, OhriskError> {
  try {
    const realPath = realpathSync(filePath);
    const relative = path.relative(boundaryRoot, realPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return err(policyReadError({
        message: "Policy files and inherited policy files must stay inside the workspace root.",
        filePath: realPath,
        details: { workspaceRoot: boundaryRoot }
      }));
    }
    return ok(realPath);
  } catch (cause) {
    return err(policyReadError({
      message: "Could not resolve policy file.",
      filePath,
      details: { cause: errorMessage(cause) }
    }));
  }
}

function realDirectory(directory: string): Result<string, OhriskError> {
  try {
    const realPath = realpathSync(directory);
    if (!statSync(realPath).isDirectory()) {
      throw new Error("Not a directory.");
    }
    return ok(realPath);
  } catch (cause) {
    return err(policyReadError({
      message: "Policy workspace root must be a readable directory.",
      filePath: directory,
      details: { cause: errorMessage(cause) }
    }));
  }
}

function policyReadError(input: {
  message: string;
  filePath: string;
  details?: Record<string, unknown>;
}): OhriskError {
  return createError({
    code: "POLICY_FILE_READ_FAILED",
    category: "filesystem",
    message: input.message,
    details: {
      filePath: input.filePath,
      ...(input.details ?? {})
    }
  });
}

function policyParseError(input: {
  message: string;
  filePath: string;
  details?: Record<string, unknown>;
}): OhriskError {
  return createError({
    code: "POLICY_FILE_PARSE_FAILED",
    category: "invalid_input",
    message: input.message,
    details: {
      filePath: input.filePath,
      ...(input.details ?? {})
    }
  });
}

function safeRelativePath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  return relative === "" ? path.basename(filePath) : relative.split(path.sep).join("/");
}

function normalizeHostname(host: string): string | undefined {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed.includes(":") || trimmed.includes("/") || trimmed.includes("@")) {
    return undefined;
  }
  try {
    const parsed = new URL(`https://${trimmed}`);
    return parsed.hostname === trimmed && isAllowedRegistryHostname(trimmed)
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedRegistryHostname(host: string): boolean {
  return isIP(host) === 0 && host !== "localhost" && !host.endsWith(".localhost");
}

function globMatches(pattern: string, value: string): boolean {
  const source = pattern
    .split("*")
    .map(escapeRegExp)
    .join(".*");
  return new RegExp(`^${source}$`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteReference(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function redactRegistryUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "invalid-registry-url";
  }
}
