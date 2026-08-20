import type { HelpTarget } from "./command";
import {
  CACHE_ACTION_DESCRIPTIONS,
  COMMAND_DESCRIPTIONS,
  COMMAND_DETAIL_USAGE,
  COMMAND_USAGE,
  helpOptionLinesFor
} from "./command-spec";

export function renderHelp(target?: HelpTarget): string {
  switch (target) {
    case "init": return renderInitHelp();
    case "scan": return renderScanHelp();
    case "ci": return renderCiHelp();
    case "diff": return renderDiffHelp();
    case "explain": return renderExplainHelp();
    case "cache": return renderCacheHelp();
    case "help": return renderHelpCommandHelp();
    case "version": return renderVersionHelp();
    case undefined: return renderTopLevelHelp();
  }
}

function renderTopLevelHelp(): string {
  return [
    "Ohrisk",
    "",
    "Usage:",
    ...Object.values(COMMAND_USAGE).map((usage) => `  ${usage}`),
    "",
    "Commands:",
    ...Object.entries(COMMAND_DESCRIPTIONS).map(
      ([command, description]) => `  ${command.padEnd(8, " ")}${description}`
    ),
    "",
    "Options:",
    ...helpOptionLinesFor("top")
  ].join("\n");
}

function renderInitHelp(): string {
  return [
    "Ohrisk init",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.init}`,
    "",
    "Options:",
    ...helpOptionLinesFor("init")
  ].join("\n");
}

function renderScanHelp(): string {
  return [
    "Ohrisk scan",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.scan}`,
    "",
    "Options:",
    ...helpOptionLinesFor("scan")
  ].join("\n");
}

function renderCiHelp(): string {
  return [
    "Ohrisk ci",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.ci}`,
    "",
    "Options:",
    ...helpOptionLinesFor("ci")
  ].join("\n");
}

function renderDiffHelp(): string {
  return [
    "Ohrisk diff",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.diff}`,
    "",
    "Options:",
    ...helpOptionLinesFor("diff")
  ].join("\n");
}

function renderCacheHelp(): string {
  return [
    "Ohrisk cache",
    "",
    "Usage:",
    ...COMMAND_DETAIL_USAGE.cache.map((usage) => `  ${usage}`),
    "",
    "Actions:",
    ...Object.entries(CACHE_ACTION_DESCRIPTIONS).map(
      ([action, description]) => `  ${action.padEnd(22, " ")}${description}`
    ),
    "",
    "Options:",
    ...helpOptionLinesFor("cache")
  ].join("\n");
}

function renderExplainHelp(): string {
  return [
    "Ohrisk explain",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.explain}`,
    "",
    "Options:",
    ...helpOptionLinesFor("explain")
  ].join("\n");
}

function renderHelpCommandHelp(): string {
  return [
    "Ohrisk help",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.help}`,
    "",
    "Commands:",
    ...Object.keys(COMMAND_DESCRIPTIONS).map((command) => `  ${command}`),
    "",
    "Options:",
    ...helpOptionLinesFor("help")
  ].join("\n");
}

function renderVersionHelp(): string {
  return [
    "Ohrisk version",
    "",
    "Usage:",
    ...COMMAND_DETAIL_USAGE.version.map((usage) => `  ${usage}`),
    "",
    "Options:",
    ...helpOptionLinesFor("version")
  ].join("\n");
}
