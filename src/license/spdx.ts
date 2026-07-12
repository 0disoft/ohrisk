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

export type SpdxLicenseNode = {
  type: "license";
  license: string;
  exception?: string;
};

export type SpdxBinaryNode = {
  type: "and" | "or";
  left: SpdxExpressionNode;
  right: SpdxExpressionNode;
};

export type SpdxExpressionNode = SpdxLicenseNode | SpdxBinaryNode;

export type ParsedSpdxExpression = {
  original: string;
  expression?: string;
  choices: string[];
  joiner: "single" | "and" | "or" | "mixed";
  malformed: boolean;
  usedAlias: boolean;
  ast?: SpdxExpressionNode;
  exceptions: string[];
};

type LexToken =
  | { type: "operand"; value: string }
  | { type: "and" | "or" | "with" | "lparen" | "rparen" };

type NormalizedOperand = {
  normalized?: string;
  malformed: boolean;
  usedAlias: boolean;
};

type ParseState = {
  tokens: LexToken[];
  index: number;
  usedAlias: boolean;
};

export function parseSpdxExpression(input: string): ParsedSpdxExpression {
  const original = input.trim();

  if (original.length === 0) {
    return malformedResult(original, [], false);
  }

  const alias = normalizeLicenseToken(original);
  if (alias.normalized && !alias.malformed && alias.normalized !== original) {
    const ast: SpdxLicenseNode = {
      type: "license",
      license: alias.normalized
    };
    return parsedResult(original, ast, true);
  }

  const shorthandOrExpression = parseShorthandOrExpression(original);
  if (shorthandOrExpression) {
    return shorthandOrExpression;
  }

  const tokens = lexExpression(original);
  if (!tokens) {
    return malformedResult(original, collectRecoverableChoices(original), false);
  }

  const state: ParseState = {
    tokens,
    index: 0,
    usedAlias: false
  };
  const ast = parseOrExpression(state);

  if (!ast || state.index !== state.tokens.length) {
    return malformedResult(
      original,
      collectChoicesFromTokens(tokens),
      state.usedAlias
    );
  }

  return parsedResult(original, ast, state.usedAlias);
}

export function formatSpdxExpression(ast: SpdxExpressionNode): string {
  return formatNode(ast, 0);
}

export function collectSpdxLicenseTerms(ast: SpdxExpressionNode): string[] {
  const terms: string[] = [];
  visitSpdxExpression(ast, (node) => {
    terms.push(node.exception ? `${node.license} WITH ${node.exception}` : node.license);
  });
  return [...new Set(terms)];
}

export function visitSpdxExpression(
  ast: SpdxExpressionNode,
  visitor: (node: SpdxLicenseNode) => void
): void {
  if (ast.type === "license") {
    visitor(ast);
    return;
  }

  visitSpdxExpression(ast.left, visitor);
  visitSpdxExpression(ast.right, visitor);
}

function parsedResult(
  original: string,
  ast: SpdxExpressionNode,
  usedAlias: boolean
): ParsedSpdxExpression {
  const choices: string[] = [];
  const exceptions: string[] = [];
  let hasAnd = false;
  let hasOr = false;

  visitNode(ast, (node) => {
    if (node.type === "license") {
      choices.push(node.license);
      if (node.exception) {
        exceptions.push(node.exception);
      }
      return;
    }

    if (node.type === "and") {
      hasAnd = true;
    } else {
      hasOr = true;
    }
  });

  const result: ParsedSpdxExpression = {
    original,
    expression: formatSpdxExpression(ast),
    choices: [...new Set(choices)],
    joiner: joinerFor(hasAnd, hasOr),
    malformed: false,
    usedAlias,
    exceptions: [...new Set(exceptions)]
  };

  // The AST is an internal evaluation aid. Keeping it non-enumerable avoids
  // silently expanding the public JSON/report surface while callers can still
  // consume it through the typed property.
  Object.defineProperty(result, "ast", {
    value: ast,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return result;
}

function malformedResult(
  original: string,
  choices: string[],
  usedAlias: boolean
): ParsedSpdxExpression {
  return {
    original,
    choices: [...new Set(choices.length > 0 ? choices : original ? [original] : [])],
    joiner: detectJoiner(original),
    malformed: true,
    usedAlias,
    exceptions: []
  };
}

function parseShorthandOrExpression(original: string): ParsedSpdxExpression | undefined {
  if (detectJoiner(original) !== "single" || !/[\/,]/.test(original)) {
    return undefined;
  }

  const rawTokens = original
    .replace(/[()]/g, " ")
    .split(/\s*(?:\/|,)\s*/)
    .map((token) => token.trim());

  if (rawTokens.length < 2 || rawTokens.some((token) => token.length === 0)) {
    return undefined;
  }

  const normalizedTokens = rawTokens.map((token) => normalizeLicenseToken(token));
  if (normalizedTokens.some((token) => token.malformed || token.normalized === undefined)) {
    return undefined;
  }

  const licenses = normalizedTokens.map((token) => token.normalized as string);
  const firstLicense = licenses[0];
  if (!firstLicense) {
    return undefined;
  }
  const ast = licenses.slice(1).reduce<SpdxExpressionNode>(
    (left, license) => ({
      type: "or",
      left,
      right: { type: "license", license }
    }),
    { type: "license", license: firstLicense }
  );

  return parsedResult(original, ast, true);
}

function lexExpression(expression: string): LexToken[] | undefined {
  const tokens: LexToken[] = [];
  let chunk = "";
  let index = 0;

  const flushOperand = (): boolean => {
    const value = chunk.trim();
    chunk = "";
    if (value.length === 0) {
      return true;
    }

    tokens.push({ type: "operand", value });
    return true;
  };

  while (index < expression.length) {
    const character = expression[index];
    if (character === "(" || character === ")") {
      flushOperand();
      tokens.push({ type: character === "(" ? "lparen" : "rparen" });
      index += 1;
      continue;
    }

    const operator = readOperatorAt(expression, index);
    if (operator) {
      flushOperand();
      tokens.push({ type: operator.value });
      index = operator.nextIndex;
      continue;
    }

    chunk += character;
    index += 1;
  }

  flushOperand();
  return tokens.length > 0 ? tokens : undefined;
}

function readOperatorAt(
  expression: string,
  index: number
): { value: "and" | "or" | "with"; nextIndex: number } | undefined {
  const candidates = ["WITH", "AND", "OR"] as const;
  for (const candidate of candidates) {
    const value = expression.slice(index, index + candidate.length);
    if (value.toUpperCase() !== candidate) {
      continue;
    }

    const previous = index === 0 ? undefined : expression[index - 1];
    const next = expression[index + candidate.length];
    if (!isOperatorBoundary(previous) || !isOperatorBoundary(next)) {
      continue;
    }

    return {
      value: candidate.toLowerCase() as "and" | "or" | "with",
      nextIndex: index + candidate.length
    };
  }

  return undefined;
}

function isOperatorBoundary(character: string | undefined): boolean {
  return character === undefined || /\s|\(|\)/.test(character);
}

function parseOrExpression(state: ParseState): SpdxExpressionNode | undefined {
  let left = parseAndExpression(state);
  if (!left) {
    return undefined;
  }

  while (peekToken(state, "or")) {
    state.index += 1;
    const right = parseAndExpression(state);
    if (!right) {
      return undefined;
    }
    left = { type: "or", left, right };
  }

  return left;
}

function parseAndExpression(state: ParseState): SpdxExpressionNode | undefined {
  let left = parseWithExpression(state);
  if (!left) {
    return undefined;
  }

  while (peekToken(state, "and")) {
    state.index += 1;
    const right = parseWithExpression(state);
    if (!right) {
      return undefined;
    }
    left = { type: "and", left, right };
  }

  return left;
}

function parseWithExpression(state: ParseState): SpdxExpressionNode | undefined {
  const primary = parsePrimaryExpression(state);
  if (!primary) {
    return undefined;
  }

  if (!peekToken(state, "with")) {
    return primary;
  }

  if (primary.type !== "license") {
    return undefined;
  }

  state.index += 1;
  const exceptionToken = state.tokens[state.index];
  if (!exceptionToken || exceptionToken.type !== "operand") {
    return undefined;
  }

  const exception = normalizeExceptionToken(exceptionToken.value);
  if (!exception) {
    return undefined;
  }

  state.index += 1;
  return {
    ...primary,
    exception
  };
}

function parsePrimaryExpression(state: ParseState): SpdxExpressionNode | undefined {
  const token = state.tokens[state.index];
  if (!token) {
    return undefined;
  }

  if (token.type === "operand") {
    const normalized = normalizeLicenseToken(token.value);
    if (normalized.malformed || !normalized.normalized) {
      return undefined;
    }

    state.usedAlias ||= normalized.usedAlias;
    state.index += 1;
    return {
      type: "license",
      license: normalized.normalized
    };
  }

  if (token.type !== "lparen") {
    return undefined;
  }

  state.index += 1;
  const nested = parseOrExpression(state);
  if (!nested || !peekToken(state, "rparen")) {
    return undefined;
  }

  state.index += 1;
  return nested;
}

function peekToken(state: ParseState, type: LexToken["type"]): boolean {
  return state.tokens[state.index]?.type === type;
}

function normalizeLicenseToken(token: string): NormalizedOperand {
  const trimmed = token.trim();
  if (!trimmed) {
    return {
      malformed: true,
      usedAlias: false
    };
  }

  const alias = LICENSE_ALIASES.get(trimmed.toLowerCase());
  if (alias) {
    return {
      normalized: alias,
      malformed: false,
      usedAlias: alias !== trimmed
    };
  }

  if (!VALID_SPDX_ID.test(trimmed)) {
    return {
      normalized: trimmed,
      malformed: true,
      usedAlias: false
    };
  }

  return {
    normalized: trimmed,
    malformed: false,
    usedAlias: false
  };
}

function normalizeExceptionToken(token: string): string | undefined {
  const trimmed = token.trim();
  return VALID_SPDX_ID.test(trimmed) ? trimmed : undefined;
}

function collectChoicesFromTokens(tokens: LexToken[]): string[] {
  return tokens.flatMap((token) => {
    if (token.type !== "operand") {
      return [];
    }

    const normalized = normalizeLicenseToken(token.value);
    return normalized.normalized && !normalized.malformed ? [normalized.normalized] : [];
  });
}

function collectRecoverableChoices(original: string): string[] {
  return original
    .replace(/[()]/g, " ")
    .split(/\s+(?:AND|OR|WITH)\s+/i)
    .flatMap((token) => {
      const normalized = normalizeLicenseToken(token);
      return normalized.normalized && !normalized.malformed ? [normalized.normalized] : [];
    });
}

function detectJoiner(expression: string): ParsedSpdxExpression["joiner"] {
  const hasAnd = /(?:^|\s|\()AND(?:$|\s|\))/i.test(expression);
  const hasOr = /(?:^|\s|\()OR(?:$|\s|\))/i.test(expression);
  return joinerFor(hasAnd, hasOr);
}

function joinerFor(
  hasAnd: boolean,
  hasOr: boolean
): ParsedSpdxExpression["joiner"] {
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

function formatNode(ast: SpdxExpressionNode, parentPrecedence: number): string {
  if (ast.type === "license") {
    return ast.exception ? `${ast.license} WITH ${ast.exception}` : ast.license;
  }

  const precedence = ast.type === "and" ? 2 : 1;
  const operator = ast.type.toUpperCase();
  const formatted = `${formatNode(ast.left, precedence)} ${operator} ${formatNode(ast.right, precedence)}`;
  return precedence < parentPrecedence ? `(${formatted})` : formatted;
}

function visitNode(
  ast: SpdxExpressionNode,
  visitor: (node: SpdxExpressionNode) => void
): void {
  visitor(ast);
  if (ast.type === "license") {
    return;
  }
  visitNode(ast.left, visitor);
  visitNode(ast.right, visitor);
}
