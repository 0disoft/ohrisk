import { describe, expect, test } from "bun:test";

import type { LicenseEvidence } from "../src/evidence/types";
import type { DependencyGraph } from "../src/graph/types";
import type { NormalizedLicense } from "../src/license/types";
import type { RiskFinding } from "../src/policy/types";
import type { RiskWaiver, WaivedRiskFinding } from "../src/policy/waivers";
import type { ProjectInput } from "../src/project/discover";
import { renderScanReport, type ScanReportInput } from "../src/report/scan-report";

const finding: RiskFinding = {
  id: "risk<script>@1.0.0::production::direct::fixture>risk<script>@1.0.0",
  fingerprint: "risk<script>@1.0.0::high::replace::unsafe & risky",
  packageId: "risk<script>@1.0.0",
  severity: "high",
  reason: "License text contains <script>alert(1)</script> & 'quotes'.",
  action: "Replace this package before shipping.",
  dependencyType: "production",
  dependencyScope: "direct",
  evidence: ["package.json license: Custom <unsafe> and 'quoted'"],
  paths: [["fixture-app", "risk<script>@1.0.0"]],
  recommendation: "replace"
};

const waiver: RiskWaiver = {
  fingerprint: finding.fingerprint,
  reason: "Temporary review waiver <not trusted> with 'quote'.",
  expiresOn: "2026-12-31"
};

function scanInput(overrides: Partial<ScanReportInput> = {}): ScanReportInput {
  const project: ProjectInput = {
    rootDir: "/tmp/fixture-app",
    lockfile: {
      kind: "bun",
      path: "/tmp/fixture-app/bun.lock"
    }
  };
  const graph: DependencyGraph = {
    rootName: "fixture-app",
    lockfilePath: "/tmp/fixture-app/bun.lock",
    nodes: [
      {
        id: finding.packageId,
        name: "risk<script>",
        version: "1.0.0",
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: finding.paths
      }
    ]
  };
  const evidence: LicenseEvidence[] = [
    {
      packageId: finding.packageId,
      packageJsonLicense: "Custom",
      files: [],
      source: "local",
      warnings: ["No LICENSE file found."]
    }
  ];
  const normalizedLicenses: NormalizedLicense[] = [
    {
      packageId: finding.packageId,
      original: "Custom",
      choices: [],
      joiner: "single",
      signals: ["custom-text"],
      evidenceSources: ["package.json"],
      confidence: "low"
    }
  ];
  const waivedFindings: WaivedRiskFinding[] = [
    {
      finding,
      waiver,
      matchedBy: "fingerprint"
    }
  ];

  return {
    project,
    graph,
    evidence,
    normalizedLicenses,
    riskFindings: [finding],
    profile: "saas",
    prodOnly: false,
    json: false,
    markdown: false,
    html: true,
    waiverMode: "local",
    waivedFindings,
    expiredWaivers: [waiver],
    unmatchedWaivers: [waiver],
    ...overrides
  };
}

type FakeListener = () => void;

class FakeClassList {
  private readonly classes: Set<string>;

  constructor(classes: string[] = []) {
    this.classes = new Set(classes);
  }

  add(value: string): void {
    this.classes.add(value);
  }

  remove(value: string): void {
    this.classes.delete(value);
  }

  contains(value: string): boolean {
    return this.classes.has(value);
  }

  toggle(value: string, force?: boolean): void {
    if (force === true) {
      this.classes.add(value);
      return;
    }

    if (force === false) {
      this.classes.delete(value);
      return;
    }

    if (this.classes.has(value)) {
      this.classes.delete(value);
    } else {
      this.classes.add(value);
    }
  }

  values(): string[] {
    return [...this.classes];
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList: FakeClassList;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  private readonly dataAttributes = new Set<string>();
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, FakeListener[]>();
  parentElement: FakeElement | undefined;
  checked = false;
  hidden = false;
  value = "";
  textContent = "";
  scrollHeight = 72;
  clientHeight = 48;
  width = 320;
  lineHeight = "16px";

  constructor(input: {
    classes?: string[];
    data?: Record<string, string>;
  } = {}) {
    this.classList = new FakeClassList(input.classes);
    for (const [key, value] of Object.entries(input.data ?? {})) {
      this.setDataAttribute(dataAttributeName(key), value);
    }
  }

  setDataAttribute(attributeName: string, value = ""): void {
    this.dataAttributes.add(attributeName);
    this.dataset[dataPropertyName(attributeName)] = value;
  }

  setAttribute(name: string, value: string): void {
    if (name.startsWith("data-")) {
      this.setDataAttribute(name, value);
      return;
    }

    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    if (name.startsWith("data-")) {
      return this.dataset[dataPropertyName(name)] ?? null;
    }

    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    if (name.startsWith("data-")) {
      this.dataAttributes.delete(name);
      delete this.dataset[dataPropertyName(name)];
      return;
    }

    this.attributes.delete(name);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) {
      return;
    }

    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = undefined;
  }

  cloneNode(deep: boolean): FakeElement {
    const clone = new FakeElement({
      classes: this.classList.values()
    });
    for (const attributeName of this.dataAttributes) {
      clone.setDataAttribute(attributeName, this.dataset[dataPropertyName(attributeName)] ?? "");
    }
    for (const [name, value] of this.attributes) {
      clone.setAttribute(name, value);
    }
    Object.assign(clone.style, this.style);
    clone.checked = this.checked;
    clone.hidden = this.hidden;
    clone.value = this.value;
    clone.textContent = this.textContent;
    clone.scrollHeight = this.scrollHeight;
    clone.clientHeight = this.clientHeight;
    clone.width = this.width;
    clone.lineHeight = this.lineHeight;

    if (deep) {
      for (const child of this.children) {
        clone.appendChild(child.cloneNode(true));
      }
    }

    return clone;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | undefined = this;
    while (current) {
      if (current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  getBoundingClientRect(): { width: number } {
    return { width: this.width };
  }

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatchEvent(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  private matches(selector: string): boolean {
    const match = selector.match(/^\[(data-[a-z0-9-]+)\]$/);
    return match?.[1] ? this.dataAttributes.has(match[1]) : false;
  }
}

class FakeDocument {
  constructor(private readonly root: FakeElement) {}

  querySelector(selector: string): FakeElement | null {
    return this.root.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.root.querySelectorAll(selector);
  }
}

class FakeWindow {
  private readonly listeners = new Map<string, FakeListener[]>();

  getComputedStyle(element: FakeElement): { lineHeight: string } {
    return { lineHeight: element.lineHeight };
  }

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatchEvent(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

function dataAttributeName(propertyName: string): string {
  return `data-${propertyName.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function dataPropertyName(attributeName: string): string {
  return attributeName
    .replace(/^data-/, "")
    .replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}

function makeFilter(value: string, checked: boolean): FakeElement {
  const filter = new FakeElement({ data: { findingFilter: "" } });
  filter.value = value;
  filter.checked = checked;
  return filter;
}

function makeSelect(dataName: string, value = "all"): FakeElement {
  const select = new FakeElement({ data: { [dataName]: "" } });
  select.value = value;
  return select;
}

function makeFindingCard(input: {
  severity: string;
  dependencyScope: string;
  recommendation: string;
  searchText: string;
}): { card: FakeElement; content: FakeElement; toggle: FakeElement } {
  const card = new FakeElement({
    data: {
      findingCard: "",
      severity: input.severity,
      dependencyScope: input.dependencyScope,
      recommendation: input.recommendation,
      searchText: input.searchText
    }
  });
  const container = new FakeElement({ data: { collapsible: "" } });
  const content = new FakeElement({
    classes: ["collapsible-content", "is-collapsed"],
    data: { collapsibleContent: "" }
  });
  const toggle = new FakeElement({
    data: {
      collapsibleToggle: "",
      expandLabel: "Show full value",
      collapseLabel: "Collapse value"
    }
  });
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = "...";
  container.appendChild(content);
  container.appendChild(toggle);
  card.appendChild(container);
  return { card, content, toggle };
}

function extractInlineScript(html: string): string {
  const match = html.match(/<script>\n([\s\S]*?)\n  <\/script>/);
  if (!match?.[1]) {
    throw new Error("Expected HTML report to include an inline script.");
  }

  return match[1];
}

function flushAnimationFrames(callbacks: FakeListener[]): void {
  while (callbacks.length > 0) {
    callbacks.shift()?.();
  }
}

describe("HTML scan report", () => {
  test("renders a browser-friendly report with escaped dynamic content", () => {
    const output = renderScanReport(scanInput());

    expect(output).toStartWith("<!doctype html>");
    expect(output).toContain('<meta http-equiv="Content-Security-Policy" content="default-src &#x27;none&#x27;; base-uri &#x27;none&#x27;; connect-src &#x27;none&#x27;; form-action &#x27;none&#x27;; frame-ancestors &#x27;none&#x27;; img-src &#x27;self&#x27; data:; script-src &#x27;unsafe-inline&#x27;; style-src &#x27;unsafe-inline&#x27;">');
    expect(output).toContain('<main class="page">');
    expect(output).toContain("<h1>Ohrisk scan</h1>");
    expect(output).toContain('<h2 id="review-summary-heading">Review summary</h2>');
    expect(output).toContain("<dt>Status</dt>");
    expect(output).toContain("<dd>High risk review needed</dd>");
    expect(output).toContain("<dt>Active findings</dt>");
    expect(output).toContain("<dd>1 active (1 high, 0 review, 0 unknown, 0 low)</dd>");
    expect(output).toContain("<dt>Scope</dt>");
    expect(output).toContain("<dd>saas profile, all dependencies</dd>");
    expect(output).toContain("<dt>Review focus</dt>");
    expect(output).toContain("<dd>Replace or escalate high-risk dependencies before shipping.</dd>");
    expect(output).toContain('<fieldset class="finding-filters">');
    expect(output).toContain('data-finding-filter');
    expect(output).toContain('data-finding-search');
    expect(output).toContain('data-finding-dependency-filter');
    expect(output).toContain('data-finding-action-filter');
    expect(output).toContain('value="low" data-finding-filter>');
    expect(output).toContain('<option value="direct">direct (1)</option>');
    expect(output).toContain('<option value="replace">replace (1)</option>');
    expect(output).toContain('<article class="finding-card" data-finding-card data-severity="high" data-dependency-scope="direct" data-recommendation="replace"');
    expect(output).toContain('data-search-text="risk&lt;script&gt;@1.0.0::production::direct::fixture&gt;risk&lt;script&gt;@1.0.0');
    expect(output).toContain("<dt>Severity</dt>");
    expect(output).toContain("<dt>Package</dt>");
    expect(output).toContain("<dt>Dependency</dt>");
    expect(output).toContain("<dt>Reason</dt>");
    expect(output).toContain("<dt>Action</dt>");
    expect(output).toContain("<dt>Path</dt>");
    expect(output).toContain("<dt>Evidence</dt>");
    expect(output).toContain("<dt>Fingerprint</dt>");
    expect(output).toContain('class="finding-detail-value" data-collapsible');
    expect(output).toContain('class="collapsible-content is-collapsed" data-collapsible-content');
    expect(output).toContain('data-collapsible-toggle');
    expect(output).toContain('aria-expanded="false">...</button>');
    expect(output).toContain("max-height: calc(1.5em * 3)");
    expect(output).toContain("const clone = content.cloneNode(true)");
    expect(output).toContain("clone.classList.remove('is-collapsed')");
    expect(output).toContain("return null;");
    expect(output).toContain("refreshVisibleCollapsibles();");
    expect(output).toContain("let visibleCollapsibleRefreshScheduled = false;");
    expect(output).toContain("if (card && !card.hidden)");
    expect(output).not.toContain("if (!card || !card.hidden)");
    expect(output).toContain("toggle.hidden = !overflowed;");
    expect(output).not.toContain("textContent || '').trim().length");
    expect(output).not.toContain("const overflowed = content.scrollHeight > content.clientHeight + 1");
    expect(output).not.toContain("content.classList.remove('is-collapsed')");
    expect(output).not.toContain("toggle.hidden = !overflowed && !expanded");
    expect(output).not.toContain("<caption>Active license-risk findings</caption>");
    expect(output).not.toContain('<th scope="col">Severity</th><th scope="col">Package</th><th scope="col">Dependency</th><th scope="col">Reason</th><th scope="col">Action</th><th scope="col">Path</th><th scope="col">Evidence</th><th scope="col">Fingerprint</th>');
    expect(output).toContain("fixture-app");
    expect(output).toContain("risk&lt;script&gt;@1.0.0");
    expect(output).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#x27;quotes&#x27;.");
    expect(output).toContain("package.json license: Custom &lt;unsafe&gt; and &#x27;quoted&#x27;");
    expect(output).toContain("Temporary review waiver &lt;not trusted&gt; with &#x27;quote&#x27;.");
    expect(output).not.toContain("<script>alert(1)</script>");
    expect(output).not.toContain("'quotes'");
  });

  test("renders empty states when no findings or waivers exist", () => {
    const output = renderScanReport(scanInput({
      riskFindings: [],
      waivedFindings: [],
      expiredWaivers: [],
      unmatchedWaivers: []
    }));

    expect(output).toContain("No active findings.");
    expect(output).toContain("<dd>No active findings</dd>");
    expect(output).toContain("<dd>0 active (0 high, 0 review, 0 unknown, 0 low)</dd>");
    expect(output).toContain("No waived findings.");
    expect(output).toContain("No expired waivers.");
    expect(output).toContain("No unmatched waivers.");
  });

  test("runs finding filters, search, collapsible toggles, and coalesced resize refreshes", () => {
    const root = new FakeElement();
    const highFilter = makeFilter("high", true);
    const lowFilter = makeFilter("low", false);
    const search = new FakeElement({ data: { findingSearch: "" } });
    const dependencyFilter = makeSelect("findingDependencyFilter");
    const actionFilter = makeSelect("findingActionFilter");
    const status = new FakeElement({ data: { findingFilterStatus: "" } });
    const empty = new FakeElement({ data: { findingFilterEmpty: "" } });
    const high = makeFindingCard({
      severity: "high",
      dependencyScope: "direct",
      recommendation: "replace",
      searchText: "risk package"
    });
    const low = makeFindingCard({
      severity: "low",
      dependencyScope: "transitive",
      recommendation: "allow",
      searchText: "safe package"
    });
    for (const element of [
      highFilter,
      lowFilter,
      search,
      dependencyFilter,
      actionFilter,
      status,
      empty,
      high.card,
      low.card
    ]) {
      root.appendChild(element);
    }

    const document = new FakeDocument(root);
    const window = new FakeWindow();
    const animationFrames: FakeListener[] = [];
    const requestAnimationFrame = (callback: FakeListener): number => {
      animationFrames.push(callback);
      return animationFrames.length;
    };
    const script = extractInlineScript(renderScanReport(scanInput()));

    new Function("document", "window", "requestAnimationFrame", script)(
      document,
      window,
      requestAnimationFrame
    );

    expect(animationFrames).toHaveLength(1);
    expect(status.textContent).toBe("1 of 2 findings shown");
    expect(empty.hidden).toBe(true);
    expect(high.card.hidden).toBe(false);
    expect(low.card.hidden).toBe(true);

    flushAnimationFrames(animationFrames);
    high.toggle.dispatchEvent("click");
    expect(high.toggle.getAttribute("aria-expanded")).toBe("true");
    expect(high.toggle.textContent).toBe("Less");
    expect(high.content.classList.contains("is-collapsed")).toBe(false);

    search.value = "safe";
    search.dispatchEvent("input");
    flushAnimationFrames(animationFrames);
    expect(status.textContent).toBe("0 of 2 findings shown");
    expect(empty.hidden).toBe(false);
    expect(high.card.hidden).toBe(true);
    expect(low.card.hidden).toBe(true);

    lowFilter.checked = true;
    lowFilter.dispatchEvent("change");
    flushAnimationFrames(animationFrames);
    expect(status.textContent).toBe("1 of 2 findings shown");
    expect(empty.hidden).toBe(true);
    expect(low.card.hidden).toBe(false);

    dependencyFilter.value = "direct";
    dependencyFilter.dispatchEvent("change");
    flushAnimationFrames(animationFrames);
    expect(status.textContent).toBe("0 of 2 findings shown");
    expect(empty.hidden).toBe(false);

    dependencyFilter.value = "all";
    actionFilter.value = "allow";
    actionFilter.dispatchEvent("change");
    flushAnimationFrames(animationFrames);
    expect(status.textContent).toBe("1 of 2 findings shown");
    expect(low.card.hidden).toBe(false);

    window.dispatchEvent("resize");
    window.dispatchEvent("resize");
    expect(animationFrames).toHaveLength(1);
  });
});
