const LICENSE_ALIASES = new Map<string, string>([
  ["apache 2", "Apache-2.0"],
  ["apache 2.0", "Apache-2.0"],
  ["apache license 2.0", "Apache-2.0"],
  ["bsd", "BSD-3-Clause"],
  ["bsd license", "BSD-3-Clause"],
  ["mit license", "MIT"],
  ["the mit license", "MIT"]
]);

const VALID_SPDX_ID = /^[A-Za-z0-9-.+]+$/;

export type ParsedSpdxExpression = {
  original: string;
  expression?: string;
  choices: string[];
  joiner: "single" | "and" | "or" | "mixed";
  malformed: boolean;
  usedAlias: boolean;
};

export function parseSpdxExpression(input: string): ParsedSpdxExpression {
  const original = input.trim();

  if (original.length === 0) {
    return {
      original,
      choices: [],
      joiner: "single",
      malformed: true,
      usedAlias: false
    };
  }

  const alias = normalizeLicenseToken(original);
  if (alias.normalized && alias.normalized !== original) {
    return {
      original,
      expression: alias.normalized,
      choices: [alias.normalized],
      joiner: "single",
      malformed: false,
      usedAlias: true
    };
  }

  const joiner = detectJoiner(original);
  const tokens = original
    .replace(/[()]/g, " ")
    .split(/\s+(?:AND|OR)\s+/i)
    .map((token) => normalizeLicenseToken(token.trim()))
    .filter((token) => token.normalized !== undefined);

  if (tokens.length === 0 || tokens.some((token) => token.malformed)) {
    return {
      original,
      choices: tokens.flatMap((token) => token.normalized ? [token.normalized] : []),
      joiner,
      malformed: true,
      usedAlias: tokens.some((token) => token.usedAlias)
    };
  }

  const expression = rebuildExpression(original, tokens.map((token) => token.normalized as string));

  return {
    original,
    expression,
    choices: [...new Set(tokens.map((token) => token.normalized as string))],
    joiner,
    malformed: false,
    usedAlias: tokens.some((token) => token.usedAlias)
  };
}

function detectJoiner(expression: string): ParsedSpdxExpression["joiner"] {
  const hasAnd = /\sAND\s/i.test(expression);
  const hasOr = /\sOR\s/i.test(expression);

  if (hasAnd && hasOr) {
    return "mixed";
  }

  if (hasAnd) {
    return "and";
  }

  if (hasOr) {
    return "or";
  }

  return "single";
}

function normalizeLicenseToken(token: string): {
  normalized?: string;
  malformed: boolean;
  usedAlias: boolean;
} {
  if (!token) {
    return {
      malformed: true,
      usedAlias: false
    };
  }

  const alias = LICENSE_ALIASES.get(token.toLowerCase());
  if (alias) {
    return {
      normalized: alias,
      malformed: false,
      usedAlias: true
    };
  }

  if (!VALID_SPDX_ID.test(token)) {
    return {
      normalized: token,
      malformed: true,
      usedAlias: false
    };
  }

  return {
    normalized: token,
    malformed: false,
    usedAlias: false
  };
}

function rebuildExpression(original: string, normalizedTokens: string[]): string {
  let index = 0;
  return original
    .replace(/[()]/g, " ")
    .split(/(\s+(?:AND|OR)\s+)/i)
    .map((part) => {
      if (/^\s*(?:AND|OR)\s*$/i.test(part)) {
        return part.trim().toUpperCase();
      }

      if (part.trim().length === 0) {
        return undefined;
      }

      const normalized = normalizedTokens[index];
      index += 1;
      return normalized;
    })
    .filter((part) => part !== undefined)
    .join(" ");
}
