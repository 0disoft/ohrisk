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

function unknownCacheFinding(input: {
  packageId: string;
  warning: string;
  paths?: string[][];
}): RiskFinding {
  return {
    id: `${input.packageId}::production::direct::fixture-app>${input.packageId}`,
    fingerprint: `${input.packageId}::unknown::collect-evidence::missing-local-source`,
    packageId: input.packageId,
    severity: "unknown",
    reason: "Package metadata does not declare a license expression.",
    action: "Collect license evidence before approving this package.",
    dependencyType: "production",
    dependencyScope: "direct",
    evidence: [
      "source: unavailable",
      `warning: ${input.warning}`
    ],
    paths: input.paths ?? [["fixture-app", input.packageId]],
    recommendation: "collect-evidence"
  };
}

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
    expect(output).toContain("<dt>License confidence</dt>");
    expect(output).toContain("<dd>0 high-confidence, 0 medium-confidence, 1 low-confidence</dd>");
    expect(output).not.toContain("<dd>0 high, 0 medium, 1 low confidence</dd>");
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

  test("renders Korean HTML report text without changing machine identifiers", () => {
    const output = renderScanReport(scanInput({
      riskFindings: [
        {
          ...finding,
          reason: "License expression is high risk for saas.",
          action: "Replace this package or escalate before shipping."
        }
      ],
      reportLanguage: "ko"
    }));

    expect(output).toStartWith("<!doctype html>");
    expect(output).toContain('<html lang="ko">');
    expect(output).toContain("<title>Ohrisk 스캔</title>");
    expect(output).toContain("<h1>Ohrisk 스캔</h1>");
    expect(output).toContain('<h2 id="review-summary-heading">검토 요약</h2>');
    expect(output).toContain("<dt>상태</dt>");
    expect(output).toContain("<dd>높은 위험 검토 필요</dd>");
    expect(output).toContain("<dt>활성 발견 항목</dt>");
    expect(output).toContain("<dd>활성 1개 (높음 1개, 검토 0개, 불명 0개, 낮음 0개)</dd>");
    expect(output).toContain("<dt>의존성</dt>");
    expect(output).toContain("<dd>총 1개, 직접 1개, 전이 0개</dd>");
    expect(output).toContain("배포 전에 높은 위험 의존성을 교체하거나 검토 단계로 올리세요.");
    expect(output).toContain("라이선스 표현식은 saas 기준에서 높은 위험입니다.");
    expect(output).toContain("배포 전에 이 패키지를 교체하거나 검토 단계로 올리세요.");
    expect(output).toContain("전체 {total}개 중 {visible}개 표시");
    expect(output).toContain("접기");
    expect(output).toContain('data-severity="high"');
    expect(output).toContain('data-recommendation="replace"');
    expect(output).toContain("risk&lt;script&gt;@1.0.0");
    expect(output).not.toContain("<script>alert(1)</script>");
  });

  test("renders Spanish HTML report text without changing machine identifiers", () => {
    const output = renderScanReport(scanInput({
      riskFindings: [
        {
          ...finding,
          reason: "License expression is high risk for saas.",
          action: "Replace this package or escalate before shipping."
        }
      ],
      reportLanguage: "es"
    }));

    expect(output).toStartWith("<!doctype html>");
    expect(output).toContain('<html lang="es">');
    expect(output).toContain("<title>Escaneo de Ohrisk</title>");
    expect(output).toContain("<h1>Escaneo de Ohrisk</h1>");
    expect(output).toContain('<h2 id="review-summary-heading">Resumen de revisión</h2>');
    expect(output).toContain("<dt>Estado</dt>");
    expect(output).toContain("<dd>Se requiere revisión de alto riesgo</dd>");
    expect(output).toContain("<dt>Hallazgos activos</dt>");
    expect(output).toContain("<dd>1 activos (1 altos, 0 revisión, 0 desconocidos, 0 bajos)</dd>");
    expect(output).toContain("<dt>Dependencias</dt>");
    expect(output).toContain("<dd>1 en total, 1 directas, 0 transitivas</dd>");
    expect(output).toContain("Reemplaza o escala las dependencias de alto riesgo antes de publicar.");
    expect(output).toContain("La expresión de licencia es de alto riesgo para saas.");
    expect(output).toContain("Reemplaza este paquete o escálalo antes de publicar.");
    expect(output).toContain("{visible} de {total} hallazgos mostrados");
    expect(output).toContain("Menos");
    expect(output).toContain('data-severity="high"');
    expect(output).toContain('data-recommendation="replace"');
    expect(output).toContain("risk&lt;script&gt;@1.0.0");
    expect(output).not.toContain("<script>alert(1)</script>");
  });

  test("renders French HTML report text without changing machine identifiers", () => {
    const output = renderScanReport(scanInput({
      riskFindings: [
        {
          ...finding,
          reason: "License expression is high risk for saas.",
          action: "Replace this package or escalate before shipping."
        }
      ],
      reportLanguage: "fr"
    }));

    expect(output).toStartWith("<!doctype html>");
    expect(output).toContain('<html lang="fr">');
    expect(output).toContain("<title>Analyse Ohrisk</title>");
    expect(output).toContain("<h1>Analyse Ohrisk</h1>");
    expect(output).toContain('<h2 id="review-summary-heading">Résumé de revue</h2>');
    expect(output).toContain("<dt>Statut</dt>");
    expect(output).toContain("<dd>Revue de risque élevé requise</dd>");
    expect(output).toContain("<dt>Résultats actifs</dt>");
    expect(output).toContain("<dd>1 actifs (1 élevés, 0 revue, 0 inconnus, 0 faibles)</dd>");
    expect(output).toContain("<dt>Dépendances</dt>");
    expect(output).toContain("<dd>1 au total, 1 directes, 0 transitives</dd>");
    expect(output).toContain("Remplacez ou escaladez les dépendances à haut risque avant la publication.");
    expect(output).toContain("L&#x27;expression de licence présente un risque élevé pour saas.");
    expect(output).toContain("Remplacez ce paquet ou escaladez-le avant la publication.");
    expect(output).toContain("{visible} résultats sur {total} affichés");
    expect(output).toContain("Moins");
    expect(output).toContain('data-severity="high"');
    expect(output).toContain('data-recommendation="replace"');
    expect(output).toContain("risk&lt;script&gt;@1.0.0");
    expect(output).not.toContain("<script>alert(1)</script>");
  });

  test("adds evidence recovery guidance when unknown findings are dominated by local Go cache misses", () => {
    const output = renderScanReport(scanInput({
      project: {
        rootDir: "/tmp/fixture-app",
        lockfile: {
          kind: "go-work",
          path: "/tmp/fixture-app/go.work"
        }
      },
      riskFindings: [
        unknownCacheFinding({
          packageId: "github.com/acme/risk-one@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        }),
        unknownCacheFinding({
          packageId: "github.com/acme/risk-two@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        })
      ],
      waivedFindings: []
    }));

    expect(output).toContain("<dt>Evidence recovery</dt>");
    expect(output).toContain("2 of 2 unknown");
    expect(output).toContain("`go mod download all`");
    expect(output).toContain("directory containing go.work (scan root)");
    expect(output).toContain("rerun Ohrisk");
    expect(output).toContain("cargo fetch");
    expect(output).toContain("dotnet restore");
    expect(output).toContain("swift package resolve");
  });

  test("adds localized evidence recovery guidance for Korean HTML reports", () => {
    const output = renderScanReport(scanInput({
      project: {
        rootDir: "/tmp/fixture-app",
        lockfile: {
          kind: "go-work",
          path: "/tmp/fixture-app/go.work"
        }
      },
      riskFindings: [
        unknownCacheFinding({
          packageId: "github.com/acme/risk-one@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        }),
        unknownCacheFinding({
          packageId: "github.com/acme/risk-two@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        })
      ],
      reportLanguage: "ko",
      waivedFindings: []
    }));

    expect(output).toContain("<dt>근거 보강</dt>");
    expect(output).toContain("불명 2개 중 2개");
    expect(output).toContain("go.work가 있는 폴더(스캔 루트)에서 `go mod download all`을 실행하세요.");
    expect(output).toContain("Ohrisk를 다시 실행하세요.");
    expect(output).toContain("cargo fetch");
    expect(output).toContain("dotnet restore");
    expect(output).toContain("swift package resolve");
  });

  test("adds localized evidence recovery guidance for Spanish HTML reports", () => {
    const output = renderScanReport(scanInput({
      project: {
        rootDir: "/tmp/fixture-app",
        lockfile: {
          kind: "go-work",
          path: "/tmp/fixture-app/go.work"
        }
      },
      riskFindings: [
        unknownCacheFinding({
          packageId: "github.com/acme/risk-one@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        }),
        unknownCacheFinding({
          packageId: "github.com/acme/risk-two@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        })
      ],
      reportLanguage: "es",
      waivedFindings: []
    }));

    expect(output).toContain("<dt>Recuperación de evidencia</dt>");
    expect(output).toContain("2 de 2 desconocidos");
    expect(output).toContain("Ejecuta `go mod download all` desde el directorio que contiene go.work (raíz del escaneo)");
    expect(output).toContain("vuelve a ejecutar Ohrisk");
    expect(output).toContain("cargo fetch");
    expect(output).toContain("dotnet restore");
    expect(output).toContain("swift package resolve");
  });

  test("adds localized evidence recovery guidance for French HTML reports", () => {
    const output = renderScanReport(scanInput({
      project: {
        rootDir: "/tmp/fixture-app",
        lockfile: {
          kind: "go-work",
          path: "/tmp/fixture-app/go.work"
        }
      },
      riskFindings: [
        unknownCacheFinding({
          packageId: "github.com/acme/risk-one@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        }),
        unknownCacheFinding({
          packageId: "github.com/acme/risk-two@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        })
      ],
      reportLanguage: "fr",
      waivedFindings: []
    }));

    expect(output).toContain("<dt>Récupération de l&#x27;évidence</dt>");
    expect(output).toContain("2 sur 2 inconnus");
    expect(output).toContain("Exécutez `go mod download all` depuis le répertoire contenant go.work (racine du scan)");
    expect(output).toContain("relancez Ohrisk");
    expect(output).toContain("cargo fetch");
    expect(output).toContain("dotnet restore");
    expect(output).toContain("swift package resolve");
  });

  test("does not add evidence recovery guidance when local cache misses are not the dominant finding source", () => {
    const output = renderScanReport(scanInput({
      riskFindings: [
        finding,
        {
          ...finding,
          id: "second-high@1.0.0::production::direct::fixture-app>second-high@1.0.0",
          fingerprint: "second-high@1.0.0::high::replace::unsafe",
          packageId: "second-high@1.0.0"
        },
        unknownCacheFinding({
          packageId: "github.com/acme/risk-one@v1.0.0",
          warning: "Go module source was not found in a local Go module cache."
        })
      ]
    }));

    expect(output).not.toContain("<dt>Evidence recovery</dt>");
    expect(output).not.toContain("go mod download all");
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
