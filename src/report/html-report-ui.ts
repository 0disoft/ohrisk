export function renderHtmlStyles(): string[] {
  return `
:root {
  color-scheme: light;
  --bg: #f5f7fa;
  --surface: #ffffff;
  --surface-subtle: #f8fafc;
  --text: #172033;
  --muted: #667085;
  --border: #d8dee8;
  --border-strong: #b8c2d2;
  --accent: #155eef;
  --accent-soft: #eef4ff;
  --sidebar: #101828;
  --sidebar-muted: #98a2b3;
  --high: #b42318;
  --high-soft: #fff1f0;
  --review: #a15c00;
  --review-soft: #fff8e8;
  --unknown: #475467;
  --unknown-soft: #f2f4f7;
  --low: #067647;
  --low-soft: #ecfdf3;
  --focus: rgba(21, 94, 239, 0.28);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
}
button, input, select { font: inherit; }
a { color: inherit; }
.report-shell { display: grid; grid-template-columns: 212px minmax(0, 1fr); min-height: 100vh; }
.report-sidebar {
  position: sticky;
  inset-block-start: 0;
  align-self: start;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding: 24px 16px;
  background: var(--sidebar);
  color: #ffffff;
}
.report-brand { margin: 0 8px 28px; font-size: 1.4rem; font-weight: 800; letter-spacing: -0.03em; }
.report-nav { display: grid; gap: 6px; }
.report-nav a {
  display: block;
  min-height: 42px;
  padding: 10px 12px;
  border-radius: 8px;
  color: #d0d5dd;
  font-weight: 650;
  text-decoration: none;
}
.report-nav a:hover { background: #1d2939; color: #ffffff; }
.report-nav a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.report-nav a:first-child { background: #1d4ed8; color: #ffffff; }
.sidebar-meta { margin-block-start: auto; padding: 16px 8px 0; color: var(--sidebar-muted); font-size: 0.78rem; overflow-wrap: anywhere; }
.sidebar-meta strong { display: block; color: #ffffff; font-size: 0.86rem; }
.page { min-width: 0; width: 100%; padding: 24px clamp(16px, 2.4vw, 36px) 56px; }
.report-header { margin-block-end: 22px; }
.report-topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-block-end: 14px; }
.eyebrow { margin: 0; color: var(--accent); font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.76rem; }
.project-pill { margin: 0; max-width: 60%; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--muted); font-size: 0.85rem; overflow-wrap: anywhere; }
.decision-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-inline-start-width: 5px;
  border-radius: 12px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}
.decision-banner-high { border-inline-start-color: var(--high); background: var(--surface); }
.decision-banner-review { border-inline-start-color: var(--review); background: var(--surface); }
.decision-banner-unknown { border-inline-start-color: var(--unknown); background: var(--surface); }
.decision-banner-low { border-inline-start-color: var(--low); background: var(--surface); }
h1 { margin: 0; font-size: clamp(1.55rem, 2.5vw, 2.15rem); line-height: 1.15; letter-spacing: -0.035em; }
h2 { margin: 0 0 14px; font-size: 1.08rem; letter-spacing: -0.01em; }
.lead { max-width: 780px; margin: 8px 0 0; color: var(--muted); }
.decision-counts { display: grid; grid-template-columns: repeat(2, max-content); gap: 8px; flex: 0 0 auto; }
.risk-pill { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 6px 10px; border-radius: 999px; font-size: 0.82rem; font-weight: 750; white-space: nowrap; }
.risk-pill strong { font-size: 1rem; }
.risk-pill-high { color: var(--high); background: var(--high-soft); }
.risk-pill-review { color: var(--review); background: var(--review-soft); }
.risk-pill-unknown { color: var(--unknown); background: var(--unknown-soft); }
.risk-pill-low { color: var(--low); background: var(--low-soft); }
section { margin-block: 18px; scroll-margin-block-start: 18px; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin: 0; }
.review-summary-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
.review-summary-grid .summary-card { grid-column: span 3; }
.summary-card { min-width: 0; padding: 15px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.summary-card dt { color: var(--muted); font-size: 0.78rem; font-weight: 650; }
.summary-card dd { margin: 7px 0 0; font-weight: 750; overflow-wrap: anywhere; }
.review-context { margin-block-start: 10px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
.review-context > summary { cursor: pointer; color: var(--muted); font-size: 0.86rem; font-weight: 700; }
.review-context[open] > summary { margin-block-end: 12px; }
.scan-summary { padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-subtle); }
.scan-summary > summary { cursor: pointer; color: var(--text); font-size: 1.02rem; font-weight: 750; }
.scan-summary[open] > summary { margin-block-end: 14px; }
.scan-summary .summary-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-block-end: 12px; }
.section-head h2 { margin: 0; }
.filter-status { margin: 0; color: var(--muted); font-size: 0.86rem; }
.finding-filter-panel { display: grid; gap: 12px; margin-block-end: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.finding-filters { margin: 0; padding: 0; border: 0; min-width: 0; }
.finding-filters legend { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.filter-options { display: flex; flex-wrap: wrap; gap: 8px; }
.filter-option { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 7px 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-subtle); color: var(--text); font-weight: 650; }
.filter-option:has(input:checked) { border-color: #84adff; background: var(--accent-soft); color: #1849a9; }
.filter-option input { margin: 0; accent-color: var(--accent); }
.filter-fields { display: grid; grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(160px, 220px)); gap: 10px; align-items: end; }
.filter-field { display: grid; gap: 6px; min-width: 0; color: var(--muted); font-weight: 700; font-size: 0.8rem; }
.filter-field input, .filter-field select { width: 100%; min-width: 0; min-height: 40px; border: 1px solid var(--border); border-radius: 8px; background: #ffffff; color: var(--text); font-weight: 500; padding: 8px 10px; }
.findings-workspace { display: grid; grid-template-columns: minmax(320px, 0.78fr) minmax(480px, 1.22fr); gap: 12px; align-items: start; }
.finding-list { display: grid; gap: 7px; max-height: min(72vh, 820px); padding-inline-end: 4px; overflow-y: auto; scrollbar-gutter: stable; }
.finding-card { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
.finding-card[hidden] { display: none; }
.finding-card.is-selected { border-color: #84adff; box-shadow: 0 0 0 2px rgba(21, 94, 239, 0.1); }
.finding-select { display: flex; align-items: start; justify-content: space-between; gap: 12px; width: 100%; min-height: 76px; padding: 13px 14px; border: 0; background: transparent; color: inherit; text-align: start; cursor: pointer; }
.finding-select:hover { background: var(--surface-subtle); }
.finding-card.is-selected .finding-select { background: var(--accent-soft); }
.finding-card-main { min-width: 0; }
.finding-title { display: block; margin: 0; min-width: 0; font-size: 0.94rem; line-height: 1.35; }
.finding-title code { font-weight: 750; }
.finding-context { margin: 5px 0 0; color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
.finding-inspector { position: sticky; inset-block-start: 18px; min-width: 0; min-height: 280px; max-height: calc(100vh - 36px); overflow: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }
.finding-inspector > .finding-details { border-top: 0; }
.finding-details { display: grid; grid-template-columns: minmax(116px, 164px) minmax(0, 1fr); margin: 0; }
.finding-details.finding-details-source { display: none; }
.finding-details dt, .finding-details dd { min-width: 0; padding: 11px 14px; border-top: 1px solid var(--border); }
.finding-details dt:first-of-type, .finding-details dd:first-of-type { border-top: 0; }
.finding-details dt { color: var(--muted); font-weight: 700; background: var(--surface-subtle); }
.finding-details dd { margin: 0; overflow-wrap: anywhere; }
.wrap-value { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.finding-detail-value { display: grid; gap: 8px; }
.collapsible-content { min-width: 0; overflow-wrap: anywhere; line-height: 1.5; }
.collapsible-content.is-collapsed { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; max-height: calc(1.5em * 3); overflow: hidden; }
.collapsible-toggle { width: 100%; min-height: 30px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-subtle); color: var(--muted); cursor: pointer; font-weight: 700; line-height: 1; }
.collapsible-toggle:hover { color: var(--text); border-color: var(--border-strong); }
.collapsible-toggle[hidden] { display: none; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
table { width: 100%; border-collapse: collapse; min-width: 860px; }
caption { text-align: start; padding: 12px 14px; color: var(--muted); font-weight: 700; }
th, td { padding: 10px 12px; border-top: 1px solid var(--border); text-align: start; vertical-align: top; }
th { color: var(--muted); font-size: 0.82rem; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 0.92em; overflow-wrap: anywhere; }
.empty { margin: 0; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; color: var(--muted); }
.finding-inspector .empty { border: 0; }
.severity { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border-radius: 999px; font-size: 0.78rem; font-weight: 750; white-space: nowrap; }
.severity-high { color: var(--high); background: var(--high-soft); }
.severity-review { color: var(--review); background: var(--review-soft); }
.severity-unknown { color: var(--unknown); background: var(--unknown-soft); }
.severity-low { color: var(--low); background: var(--low-soft); }
@media (max-width: 1120px) {
  .review-summary-grid .summary-card { grid-column: span 6; }
  .findings-workspace { grid-template-columns: minmax(280px, 0.9fr) minmax(420px, 1.1fr); }
}
@media (max-width: 900px) {
  .report-shell { grid-template-columns: 1fr; }
  .report-sidebar { position: static; min-height: 0; padding: 12px 16px; }
  .report-brand { margin: 0 0 10px; }
  .report-nav { display: flex; gap: 6px; overflow-x: auto; }
  .report-nav { scrollbar-width: none; }
  .report-nav::-webkit-scrollbar { display: none; }
  .report-nav a { flex: 0 0 auto; }
  .sidebar-meta { display: none; }
  .decision-banner { align-items: start; flex-direction: column; }
  .decision-counts { grid-template-columns: repeat(4, max-content); max-width: 100%; overflow-x: auto; }
  .findings-workspace { grid-template-columns: 1fr; }
  .finding-list { max-height: none; }
  .finding-inspector { position: static; max-height: none; }
}
@media (max-width: 640px) {
  .page { padding: 16px 10px 40px; }
  .report-topline { align-items: start; flex-direction: column; }
  .project-pill { max-width: 100%; }
  .decision-banner { padding: 18px 16px; }
  .decision-counts { grid-template-columns: repeat(2, max-content); }
  .review-summary-grid { grid-template-columns: 1fr; }
  .review-summary-grid .summary-card { grid-column: auto; }
  .filter-fields { grid-template-columns: 1fr; }
  .finding-details { grid-template-columns: 1fr; }
  .finding-details dt { padding-block-end: 4px; }
  .finding-details dd { padding-block-start: 0; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  `.trim().split("\n");
}
