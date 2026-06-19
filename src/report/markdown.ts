function normalizeMarkdownInline(value: string): string {
  return value.replace(/\r?\n/g, " ");
}

function escapeMarkdownTableText(value: string): string {
  return normalizeMarkdownInline(value)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|");
}

function escapeMarkdownTableCodeText(value: string): string {
  return normalizeMarkdownInline(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function escapeHtmlCode(value: string): string {
  return normalizeMarkdownInline(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/`/g, "&#96;");
}

export function formatMarkdownInlineCode(value: string): string {
  const normalized = normalizeMarkdownInline(value);
  const backtickRuns = normalized.match(/`+/g) ?? [];
  const longestRunLength = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRunLength + 1);

  if (longestRunLength === 0) {
    return `${fence}${normalized}${fence}`;
  }

  return `${fence} ${normalized} ${fence}`;
}

export function formatMarkdownTableCell(value: string): string {
  return escapeMarkdownTableText(value);
}

export function formatMarkdownTableCode(value: string): string {
  if (value.includes("`")) {
    return `<code>${escapeHtmlCode(value)}</code>`;
  }

  return formatMarkdownInlineCode(escapeMarkdownTableCodeText(value));
}
