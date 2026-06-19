const LICENSE_ALIASES = new Map<string, string>([
  ["apache 2", "Apache-2.0"],
  ["apache 2.0", "Apache-2.0"],
  ["apache license 2.0", "Apache-2.0"],
  ["apache license version 2.0", "Apache-2.0"],
  ["apache license, version 2.0", "Apache-2.0"],
  ["bsd", "BSD-3-Clause"],
  ["bsd 2-clause", "BSD-2-Clause"],
  ["bsd 3-clause", "BSD-3-Clause"],
  ["bsd-2-clause license", "BSD-2-Clause"],
  ["bsd-3-clause license", "BSD-3-Clause"],
  ["bsd license", "BSD-3-Clause"],
  ["business source license", "BUSL-1.1"],
  ["business source license 1.1", "BUSL-1.1"],
  ["busl", "BUSL-1.1"],
  ["commons clause", "Commons-Clause"],
  ["commons clause license condition", "Commons-Clause"],
  ["elastic license", "Elastic-2.0"],
  ["elastic license 2.0", "Elastic-2.0"],
  ["2-clause bsd", "BSD-2-Clause"],
  ["3-clause bsd", "BSD-3-Clause"],
  ["simplified bsd license", "BSD-2-Clause"],
  ["new bsd license", "BSD-3-Clause"],
  ["isc license", "ISC"],
  ["mit license", "MIT"],
  ["polyform free trial 1.0.0", "PolyForm-Free-Trial-1.0.0"],
  ["polyform noncommercial 1.0.0", "PolyForm-Noncommercial-1.0.0"],
  ["server side public license", "SSPL-1.0"],
  ["server side public license 1.0", "SSPL-1.0"],
  ["sspl", "SSPL-1.0"],
  ["the mit license", "MIT"],
  ["unlicensed", "UNLICENSED"]
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

  const tokenWithoutException = stripWithException(token);
  const alias = LICENSE_ALIASES.get(tokenWithoutException.toLowerCase());
  if (alias) {
    return {
      normalized: alias,
      malformed: false,
      usedAlias: alias !== tokenWithoutException
    };
  }

  if (!VALID_SPDX_ID.test(tokenWithoutException)) {
    return {
      normalized: token,
      malformed: true,
      usedAlias: false
    };
  }

  return {
    normalized: tokenWithoutException,
    malformed: false,
    usedAlias: tokenWithoutException !== token
  };
}

function stripWithException(token: string): string {
  return token.split(/\s+WITH\s+/i)[0]?.trim() ?? token;
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
