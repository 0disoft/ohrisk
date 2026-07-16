import type { OhriskError } from "../shared/errors";
import { ok, type Result } from "../shared/result";

export type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
};

export type XmlParseErrorFactory = (
  lockfilePath: string,
  cause: string
) => Result<never, OhriskError>;

export function parseXmlDocument(
  input: string,
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<XmlNode, OhriskError> {
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let index = 0;

  while (index < input.length) {
    const tagStart = input.indexOf("<", index);
    if (tagStart === -1) {
      const appended = appendText(input.slice(index), stack, lockfilePath, parseError);
      return appended.ok ? completeXmlDocument(root, stack, lockfilePath, parseError) : appended;
    }

    const textResult = appendText(input.slice(index, tagStart), stack, lockfilePath, parseError);
    if (!textResult.ok) {
      return textResult;
    }

    if (input.startsWith("<!--", tagStart)) {
      const commentEnd = input.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) {
        return parseError(lockfilePath, "Unclosed XML comment.");
      }

      index = commentEnd + 3;
      continue;
    }

    if (input.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = input.indexOf("]]>", tagStart + 9);
      if (cdataEnd === -1) {
        return parseError(lockfilePath, "Unclosed XML CDATA section.");
      }

      const current = stack[stack.length - 1];
      if (current) {
        current.text += input.slice(tagStart + 9, cdataEnd);
      }
      index = cdataEnd + 3;
      continue;
    }

    if (input.startsWith("<?", tagStart)) {
      const instructionEnd = input.indexOf("?>", tagStart + 2);
      if (instructionEnd === -1) {
        return parseError(lockfilePath, "Unclosed XML processing instruction.");
      }

      index = instructionEnd + 2;
      continue;
    }

    if (input.startsWith("<!", tagStart)) {
      return parseError(lockfilePath, "Unsupported XML declaration.");
    }

    const tagEnd = input.indexOf(">", tagStart + 1);
    if (tagEnd === -1) {
      return parseError(lockfilePath, "Unclosed XML tag.");
    }

    const rawTag = input.slice(tagStart + 1, tagEnd).trim();
    if (rawTag === "") {
      return parseError(lockfilePath, "Empty XML tag.");
    }

    if (rawTag.startsWith("/")) {
      const closed = closeXmlNode(rawTag.slice(1), stack, lockfilePath, parseError);
      if (!closed.ok) {
        return closed;
      }

      const attached = attachXmlNode(closed.value, stack, root, lockfilePath, parseError);
      if (!attached.ok) {
        return attached;
      }

      root = attached.value;
      index = tagEnd + 1;
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const startTag = parseStartTag(
      selfClosing ? rawTag.slice(0, -1).trimEnd() : rawTag,
      lockfilePath,
      parseError
    );
    if (!startTag.ok) {
      return startTag;
    }

    const node: XmlNode = {
      name: localName(startTag.value.name),
      attributes: startTag.value.attributes,
      children: [],
      text: ""
    };

    if (selfClosing) {
      const attached = attachXmlNode(node, stack, root, lockfilePath, parseError);
      if (!attached.ok) {
        return attached;
      }

      root = attached.value;
    } else {
      stack.push(node);
    }

    index = tagEnd + 1;
  }

  return completeXmlDocument(root, stack, lockfilePath, parseError);
}

export function childText(node: XmlNode | undefined, name: string): string | undefined {
  const child = firstChild(node, name);
  const text = child?.text.trim();
  return text === "" ? undefined : text;
}

export function firstChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return childNodes(node, name)[0];
}

export function childNodes(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((child) => child.name === name) ?? [];
}

export function localName(name: string): string {
  const colonIndex = name.indexOf(":");
  return colonIndex === -1 ? name : name.slice(colonIndex + 1);
}

function appendText(
  text: string,
  stack: XmlNode[],
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<undefined, OhriskError> {
  if (text === "") {
    return ok(undefined);
  }

  const decoded = decodeXmlText(text, lockfilePath, parseError);
  if (!decoded.ok) {
    return decoded;
  }

  const current = stack[stack.length - 1];
  if (current) {
    current.text += decoded.value;
  } else if (decoded.value.trim() !== "") {
    return parseError(lockfilePath, "Unexpected text outside the XML root element.");
  }

  return ok(undefined);
}

function closeXmlNode(
  rawClosingTag: string,
  stack: XmlNode[],
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<XmlNode, OhriskError> {
  const closingName = localName(rawClosingTag.trim().split(/\s+/)[0] ?? "");
  const node = stack.pop();
  if (!node) {
    return parseError(lockfilePath, "Unexpected XML closing tag.");
  }

  if (node.name !== closingName) {
    return parseError(
      lockfilePath,
      `Mismatched XML closing tag. Expected </${node.name}> but found </${closingName}>.`
    );
  }

  return ok(node);
}

function attachXmlNode(
  node: XmlNode,
  stack: XmlNode[],
  root: XmlNode | undefined,
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<XmlNode | undefined, OhriskError> {
  const parent = stack[stack.length - 1];
  if (parent) {
    parent.children.push(node);
    return ok(root);
  }

  if (root) {
    return parseError(lockfilePath, "Multiple XML root elements.");
  }

  return ok(node);
}

function completeXmlDocument(
  root: XmlNode | undefined,
  stack: XmlNode[],
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<XmlNode, OhriskError> {
  if (stack.length > 0) {
    return parseError(lockfilePath, `Unclosed XML tag <${stack[stack.length - 1]?.name}>.`);
  }

  if (!root) {
    return parseError(lockfilePath, "Missing XML root element.");
  }

  return ok(root);
}

function parseStartTag(
  rawTag: string,
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<{ name: string; attributes: Record<string, string> }, OhriskError> {
  const nameMatch = rawTag.match(/^([^\s/>]+)/);
  if (!nameMatch) {
    return parseError(lockfilePath, "Missing XML element name.");
  }

  const name = nameMatch[1] ?? "";
  const attributes = parseAttributes(rawTag.slice(name.length), lockfilePath, parseError);
  if (!attributes.ok) {
    return attributes;
  }

  return ok({
    name,
    attributes: attributes.value
  });
}

function parseAttributes(
  input: string,
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<Record<string, string>, OhriskError> {
  const attributes: Record<string, string> = {};
  let index = 0;

  while (index < input.length) {
    while (/\s/.test(input[index] ?? "")) {
      index += 1;
    }

    if (index >= input.length) {
      break;
    }

    const nameStart = index;
    while (index < input.length && !/[\s=]/.test(input[index] ?? "")) {
      index += 1;
    }

    const name = input.slice(nameStart, index);
    if (name === "") {
      return parseError(lockfilePath, "Malformed XML attribute.");
    }

    while (/\s/.test(input[index] ?? "")) {
      index += 1;
    }

    if (input[index] !== "=") {
      return parseError(lockfilePath, `XML attribute "${name}" is missing a value.`);
    }
    index += 1;

    while (/\s/.test(input[index] ?? "")) {
      index += 1;
    }

    const quote = input[index];
    if (quote !== "\"" && quote !== "'") {
      return parseError(lockfilePath, `XML attribute "${name}" must use quotes.`);
    }
    index += 1;

    const valueStart = index;
    while (index < input.length && input[index] !== quote) {
      index += 1;
    }

    if (index >= input.length) {
      return parseError(lockfilePath, `Unclosed XML attribute "${name}".`);
    }

    const decoded = decodeXmlText(input.slice(valueStart, index), lockfilePath, parseError);
    if (!decoded.ok) {
      return decoded;
    }

    attributes[localName(name)] = decoded.value;
    index += 1;
  }

  return ok(attributes);
}

function decodeXmlText(
  input: string,
  lockfilePath: string,
  parseError: XmlParseErrorFactory
): Result<string, OhriskError> {
  let failedEntity: string | undefined;
  const decoded = input.replace(/&([^;]+);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return "\"";
      case "apos":
        return "'";
      default:
        const codePoint = parseXmlNumericEntity(entity);
        if (codePoint !== undefined) {
          return String.fromCodePoint(codePoint);
        }

        failedEntity = match;
        return match;
    }
  });

  if (failedEntity) {
    return parseError(lockfilePath, `Unsupported XML entity ${failedEntity}.`);
  }

  return ok(decoded);
}

function parseXmlNumericEntity(entity: string): number | undefined {
  const hexadecimal = entity.match(/^#x([0-9A-Fa-f]+)$/);
  const decimal = entity.match(/^#([0-9]+)$/);
  const digits = hexadecimal?.[1] ?? decimal?.[1];
  if (!digits) {
    return undefined;
  }

  const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
  return isXml10CodePoint(codePoint) ? codePoint : undefined;
}

function isXml10CodePoint(codePoint: number): boolean {
  return codePoint === 0x9
    || codePoint === 0xa
    || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}
