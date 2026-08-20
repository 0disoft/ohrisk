import type { UsageProfile } from "../policy/profiles";
import type { RiskSeverity } from "../policy/types";
import type { ReportLanguage } from "../report/language";
import type {
  GitHubRepository,
  RepositorySubmoduleMode
} from "../repository/github-repository";

export const SUPPORTED_COMMANDS = [
  "init",
  "scan",
  "ci",
  "diff",
  "explain",
  "cache",
  "help",
  "version"
] as const;

export type HelpTarget = typeof SUPPORTED_COMMANDS[number];
export type CacheAction = "status" | "prune" | "clear";

export type CliCommand =
  | { kind: "help"; target?: HelpTarget }
  | { kind: "version" }
  | {
      kind: "init";
      profile: UsageProfile;
      failOn: RiskSeverity;
      workflow: boolean;
      waivers: boolean;
    }
  | {
      kind: "cache";
      action: CacheAction;
      json: boolean;
      cacheDir?: string;
      maxSizeBytes?: number;
      maxAgeMs?: number;
    }
  | {
      kind: "scan";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
      markdown: boolean;
      html: boolean;
      reportLanguage?: ReportLanguage;
      cyclonedx: boolean;
      noWaivers: boolean;
      lockfilePath?: string;
      archivePath?: string;
      repository?: GitHubRepository;
      submoduleMode?: RepositorySubmoduleMode;
      allLockfiles?: boolean;
      policyPath?: string;
      offline?: boolean;
      cacheDir?: string;
      jobs?: number;
      timeoutMs?: number;
      registryUrl?: string;
      registryTokenEnv?: string;
      allowedHosts?: string[];
      workspaceRootPath?: string;
      outputPath?: string;
      openReport?: boolean;
    }
  | {
      kind: "ci";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
      markdown: boolean;
      html: boolean;
      reportLanguage?: ReportLanguage;
      cyclonedx: boolean;
      noWaivers: boolean;
      lockfilePath?: string;
      archivePath?: string;
      allLockfiles?: boolean;
      policyPath?: string;
      offline?: boolean;
      cacheDir?: string;
      jobs?: number;
      timeoutMs?: number;
      registryUrl?: string;
      registryTokenEnv?: string;
      allowedHosts?: string[];
      workspaceRootPath?: string;
      outputPath?: string;
      openReport?: boolean;
      failOn: RiskSeverity;
      strictWaivers: boolean;
      allowPartialEvidence: boolean;
    }
  | {
      kind: "diff";
      baselineRef: string;
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      markdown: boolean;
      lockfilePath?: string;
      allLockfiles?: boolean;
      policyPath?: string;
      offline?: boolean;
      cacheDir?: string;
      jobs?: number;
      timeoutMs?: number;
      registryUrl?: string;
      registryTokenEnv?: string;
      allowedHosts?: string[];
      workspaceRootPath?: string;
      outputPath?: string;
      failOn?: RiskSeverity;
    }
  | {
      kind: "explain";
      expression: string;
      profile: UsageProfile;
      json: boolean;
      policyPath?: string;
      workspaceRootPath?: string;
      outputPath?: string;
    };
