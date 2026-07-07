import { NOTICE_ACTION } from "../policy/evaluate";
import type {
  RiskDependencyScope,
  RiskDependencyType,
  RiskFinding,
  RiskRecommendation,
  RiskSeverity
} from "../policy/types";
import type { RiskWaiver } from "../policy/waivers";
import type { ThresholdSummary } from "./threshold-summary";
import {
  DEFAULT_REPORT_LANGUAGE,
  type ReportLanguage
} from "./language";

type RiskCounts = Record<RiskSeverity, number>;
type WaiverMode = "local" | "ignored";
type WaiverDriftSummary = {
  strictWaivers?: true;
  waiverDriftFailed?: boolean;
  waiverDriftCount?: number;
};

export type HtmlReportText = {
  htmlLang: string;
  title: string;
  labels: {
    action: string;
    activeFindings: string;
    dependency: string;
    dependencies: string;
    evidence: string;
    evidenceDetail: string;
    expiresOn: string;
    expiredWaivers: string;
    findingPath: string;
    findings: string;
    fingerprint: string;
    licenseConfidence: string;
    licenseIssues: string;
    lockfile: string;
    matchedBy: string;
    next: string;
    package: string;
    path: string;
    prodOnly: string;
    profile: string;
    project: string;
    reason: string;
    reviewFocus: string;
    reviewSummary: string;
    risks: string;
    scope: string;
    search: string;
    severity: string;
    status: string;
    summary: string;
    target: string;
    threshold: string;
    unmatchedWaivers: string;
    waiverDrift: string;
    waiverMode: string;
    waived: string;
    waivedFindings: string;
    waivers: string;
  };
  messages: {
    allActions: string;
    allDependencies: string;
    collapseText: string;
    defaultCollapseLabel: string;
    defaultExpandLabel: string;
    searchPlaceholder: string;
    noActiveFindings: string;
    noExpiredWaivers: string;
    noMatchingFindings: string;
    noUnmatchedWaivers: string;
    noWaivedFindings: string;
    waiverMode: (mode: WaiverMode) => string;
    dependencies: (total: number, direct: number, transitive: number) => string;
    evidence: (files: number, warnings: number) => string;
    licenseConfidence: (high: number, medium: number, low: number) => string;
    licenseIssues: (missing: number, malformed: number) => string;
    risks: (risks: RiskCounts) => string;
    waived: (applied: number, expired: number, unmatched: number) => string;
    reviewStatus: (risks: RiskCounts) => string;
    activeFindings: (risks: RiskCounts) => string;
    scope: (profile: string, prodOnly: boolean) => string;
    reviewWaivers: (applied: number, driftEntries: number) => string;
    reviewWaiverDrift: (summary: WaiverDriftSummary) => string;
    threshold: (summary: ThresholdSummary) => string | undefined;
    waiverDrift: (summary: WaiverDriftSummary) => string | undefined;
    nextAction: (findings: RiskFinding[]) => string;
    severity: (severity: RiskSeverity) => string;
    recommendation: (recommendation: RiskRecommendation) => string;
    dependencyScope: (scope: RiskDependencyScope) => string;
    dependencyType: (type: RiskDependencyType) => string;
    dependencyContext: (finding: RiskFinding) => string;
    findingReason: (finding: RiskFinding, profile: string) => string;
    findingAction: (finding: RiskFinding) => string;
    waiverTarget: (waiver: RiskWaiver) => string;
    expandLabel: (label: string) => string;
    collapseLabel: (label: string) => string;
    filterStatusTemplate: string;
  };
  captions: {
    waivedFindings: string;
    expiredWaivers: string;
    unmatchedWaivers: string;
  };
};

const ENGLISH_TEXT: HtmlReportText = {
  htmlLang: "en",
  title: "Ohrisk scan",
  labels: {
    action: "Action",
    activeFindings: "Active findings",
    dependency: "Dependency",
    dependencies: "Dependencies",
    evidence: "Evidence",
    evidenceDetail: "Evidence",
    expiresOn: "Expires on",
    expiredWaivers: "Expired waivers",
    findingPath: "Path",
    findings: "Findings",
    fingerprint: "Fingerprint",
    licenseConfidence: "License confidence",
    licenseIssues: "License issues",
    lockfile: "Lockfile",
    matchedBy: "Matched by",
    next: "Next",
    package: "Package",
    path: "Path",
    prodOnly: "Production only",
    profile: "Profile",
    project: "Project",
    reason: "Reason",
    reviewFocus: "Review focus",
    reviewSummary: "Review summary",
    risks: "Risks",
    scope: "Scope",
    search: "Search",
    severity: "Severity",
    status: "Status",
    summary: "Summary",
    target: "Target",
    threshold: "Threshold",
    unmatchedWaivers: "Unmatched waivers",
    waiverDrift: "Waiver drift",
    waiverMode: "Waiver mode",
    waived: "Waived",
    waivedFindings: "Waived findings",
    waivers: "Waivers"
  },
  messages: {
    allActions: "All actions",
    allDependencies: "All dependencies",
    collapseText: "Less",
    defaultCollapseLabel: "Collapse value",
    defaultExpandLabel: "Show full value",
    searchPlaceholder: "Package, reason, evidence",
    noActiveFindings: "No active findings.",
    noExpiredWaivers: "No expired waivers.",
    noMatchingFindings: "No findings match the selected filters.",
    noUnmatchedWaivers: "No unmatched waivers.",
    noWaivedFindings: "No waived findings.",
    waiverMode: (mode) =>
      mode === "ignored" ? "ignored (--no-waivers)" : "local (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `${total} total, ${direct} direct, ${transitive} transitive`,
    evidence: (files, warnings) => `${files} files, ${warnings} warnings`,
    licenseConfidence: (high, medium, low) =>
      `${high} high-confidence, ${medium} medium-confidence, ${low} low-confidence`,
    licenseIssues: (missing, malformed) => `${missing} missing, ${malformed} malformed`,
    risks: (risks) =>
      `${risks.high} high, ${risks.review} review, ${risks.unknown} unknown, ${risks.low} low`,
    waived: (applied, expired, unmatched) =>
      `${applied} applied, ${expired} expired, ${unmatched} unmatched`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "High risk review needed";
      if (risks.unknown > 0) return "Evidence review needed";
      if (risks.review > 0) return "Policy review needed";
      if (risks.low > 0) return "Low risk findings only";
      return "No active findings";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} active (${risks.high} high, ${risks.review} review, ${risks.unknown} unknown, ${risks.low} low)`;
    },
    scope: (profile, prodOnly) =>
      `${profile} profile, ${prodOnly ? "production only" : "all dependencies"}`,
    reviewWaivers: (applied, driftEntries) => `${applied} applied, ${driftEntries} drift entries`,
    reviewWaiverDrift: (summary) => {
      const line = englishWaiverDrift(summary);
      return line?.replace(/^Waiver drift: /, "") ?? "Not checked (--strict-waivers not set)";
    },
    threshold: englishThreshold,
    waiverDrift: englishWaiverDrift,
    nextAction: englishNextAction,
    severity: (severity) => severity,
    recommendation: (recommendation) => recommendation,
    dependencyScope: (scope) => scope,
    dependencyType: (type) => type,
    dependencyContext: (finding) => `${finding.dependencyType} ${finding.dependencyScope}`,
    findingReason: (finding) => finding.reason,
    findingAction: (finding) => finding.action,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `fingerprint: ${waiver.fingerprint ?? "unknown"}`,
    expandLabel: (label) => `Show full ${label}`,
    collapseLabel: (label) => `Collapse ${label}`,
    filterStatusTemplate: "{visible} of {total} findings shown"
  },
  captions: {
    waivedFindings: "Findings suppressed by local waivers",
    expiredWaivers: "Expired local waiver entries",
    unmatchedWaivers: "Active waiver entries that did not match current findings"
  }
};

const KOREAN_TEXT: HtmlReportText = {
  htmlLang: "ko",
  title: "Ohrisk 스캔",
  labels: {
    action: "조치",
    activeFindings: "활성 발견 항목",
    dependency: "의존성",
    dependencies: "의존성",
    evidence: "근거",
    evidenceDetail: "근거",
    expiresOn: "만료일",
    expiredWaivers: "만료된 예외",
    findingPath: "경로",
    findings: "발견 항목",
    fingerprint: "핑거프린트",
    licenseConfidence: "라이선스 신뢰도",
    licenseIssues: "라이선스 문제",
    lockfile: "락파일",
    matchedBy: "매칭 기준",
    next: "다음 조치",
    package: "패키지",
    path: "경로",
    prodOnly: "프로덕션만",
    profile: "프로필",
    project: "프로젝트",
    reason: "이유",
    reviewFocus: "검토 초점",
    reviewSummary: "검토 요약",
    risks: "위험",
    scope: "범위",
    search: "검색",
    severity: "심각도",
    status: "상태",
    summary: "요약",
    target: "대상",
    threshold: "임계값",
    unmatchedWaivers: "매칭되지 않은 예외",
    waiverDrift: "예외 드리프트",
    waiverMode: "예외 모드",
    waived: "예외 처리",
    waivedFindings: "예외 처리된 항목",
    waivers: "예외"
  },
  messages: {
    allActions: "모든 조치",
    allDependencies: "모든 의존성",
    collapseText: "접기",
    defaultCollapseLabel: "값 접기",
    defaultExpandLabel: "전체 값 보기",
    searchPlaceholder: "패키지, 이유, 근거",
    noActiveFindings: "활성 발견 항목이 없습니다.",
    noExpiredWaivers: "만료된 예외가 없습니다.",
    noMatchingFindings: "선택한 필터와 일치하는 발견 항목이 없습니다.",
    noUnmatchedWaivers: "매칭되지 않은 예외가 없습니다.",
    noWaivedFindings: "예외 처리된 항목이 없습니다.",
    waiverMode: (mode) =>
      mode === "ignored" ? "무시됨 (--no-waivers)" : "로컬 (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `총 ${total}개, 직접 ${direct}개, 전이 ${transitive}개`,
    evidence: (files, warnings) => `파일 ${files}개, 경고 ${warnings}개`,
    licenseConfidence: (high, medium, low) =>
      `높은 신뢰도 ${high}개, 중간 신뢰도 ${medium}개, 낮은 신뢰도 ${low}개`,
    licenseIssues: (missing, malformed) => `누락 ${missing}개, 형식 오류 ${malformed}개`,
    risks: (risks) =>
      `높음 ${risks.high}개, 검토 ${risks.review}개, 불명 ${risks.unknown}개, 낮음 ${risks.low}개`,
    waived: (applied, expired, unmatched) =>
      `적용 ${applied}개, 만료 ${expired}개, 미매칭 ${unmatched}개`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "높은 위험 검토 필요";
      if (risks.unknown > 0) return "근거 검토 필요";
      if (risks.review > 0) return "정책 검토 필요";
      if (risks.low > 0) return "낮은 위험 항목만 있음";
      return "활성 발견 항목 없음";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `활성 ${total}개 (높음 ${risks.high}개, 검토 ${risks.review}개, 불명 ${risks.unknown}개, 낮음 ${risks.low}개)`;
    },
    scope: (profile, prodOnly) =>
      `${profile} 프로필, ${prodOnly ? "프로덕션 의존성만" : "모든 의존성"}`,
    reviewWaivers: (applied, driftEntries) =>
      `적용 ${applied}개, 드리프트 항목 ${driftEntries}개`,
    reviewWaiverDrift: (summary) => koreanWaiverDrift(summary) ?? "확인 안 됨 (--strict-waivers 미설정)",
    threshold: koreanThreshold,
    waiverDrift: koreanWaiverDrift,
    nextAction: koreanNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "높음";
        case "review":
          return "검토";
        case "unknown":
          return "불명";
        case "low":
          return "낮음";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "교체";
        case "review":
          return "검토";
        case "collect-evidence":
          return "근거 수집";
        case "exclude-dev-only":
          return "개발 전용 제외";
        case "allow":
          return "허용";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "직접" : "전이"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "프로덕션";
        case "development":
          return "개발";
        case "optional":
          return "선택";
        case "peer":
          return "피어";
        case "unknown":
          return "알 수 없음";
      }
    },
    dependencyContext: (finding) =>
      `${KOREAN_TEXT.messages.dependencyType(finding.dependencyType)} ${KOREAN_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: koreanFindingReason,
    findingAction: koreanFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `fingerprint: ${waiver.fingerprint ?? "알 수 없음"}`,
    expandLabel: (label) => `${label} 전체 보기`,
    collapseLabel: (label) => `${label} 접기`,
    filterStatusTemplate: "전체 {total}개 중 {visible}개 표시"
  },
  captions: {
    waivedFindings: "로컬 예외로 억제된 발견 항목",
    expiredWaivers: "만료된 로컬 예외 항목",
    unmatchedWaivers: "현재 발견 항목과 매칭되지 않은 활성 예외 항목"
  }
};

const HTML_REPORT_TEXT: Record<ReportLanguage, HtmlReportText> = {
  en: ENGLISH_TEXT,
  ko: KOREAN_TEXT
};

export function htmlReportText(language: ReportLanguage | undefined): HtmlReportText {
  return HTML_REPORT_TEXT[language ?? DEFAULT_REPORT_LANGUAGE];
}

function englishThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "failed" : "passed";
  const findingLabel = summary.failingFindingCount === 1 ? "finding" : "findings";

  return `Threshold: ${outcome} on ${summary.failOn} (${summary.failingFindingCount} ${findingLabel} at or above threshold)`;
}

function koreanThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "실패" : "통과";
  const severity = KOREAN_TEXT.messages.severity(summary.failOn);

  return `임계값: ${severity} 기준 ${outcome} (임계값 이상 ${summary.failingFindingCount}개)`;
}

function englishWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "failed" : "passed";
  return `Waiver drift: ${status} (${summary.waiverDriftCount} expired or unmatched waivers)`;
}

function koreanWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "실패" : "통과";
  return `예외 드리프트: ${status} (만료 또는 미매칭 예외 ${summary.waiverDriftCount}개)`;
}

function englishNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Replace or escalate high-risk dependencies before shipping.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Collect missing license evidence before approving this project.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Review flagged dependencies before shipping under this profile.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Run with --prod or keep dev-only risk out of production.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Preserve required NOTICE or attribution files when distributing this project.";
  }

  return "No action needed for this profile.";
}

function koreanNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "배포 전에 높은 위험 의존성을 교체하거나 검토 단계로 올리세요.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "프로젝트를 승인하기 전에 누락된 라이선스 근거를 수집하세요.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "이 프로필로 배포하기 전에 표시된 의존성을 검토하세요.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "--prod로 다시 실행하거나 개발 전용 위험이 프로덕션에 들어가지 않게 하세요.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "프로젝트를 배포할 때 필요한 NOTICE 또는 저작권 표시 파일을 유지하세요.";
  }

  return "이 프로필에서는 추가 조치가 필요하지 않습니다.";
}

function koreanFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "로컬 패키지가 package.json에서 private로 표시되어 있어, 공개 라이선스 메타데이터 누락을 내부 패키지 근거로 처리했습니다.";
    case `License expression is low risk for ${profile}.`:
      return `라이선스 표현식은 ${profile} 기준에서 낮은 위험입니다.`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `${profile} 기준으로 배포하기 전에 라이선스 표현식을 검토해야 합니다.`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "패키지 메타데이터가 이 패키지를 UNLICENSED로 명시합니다.";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `라이선스 표현식에 ${profile} 기준의 소스 공개형 또는 상업적 사용 제한이 포함되어 있습니다.`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `라이선스 근거에 ${profile} 기준의 명시적인 상업적 사용 제한이 포함되어 있습니다.`;
    case `License expression is high risk for ${profile}.`:
      return `라이선스 표현식은 ${profile} 기준에서 높은 위험입니다.`;
    case "Package metadata does not declare a license expression.":
      return "패키지 메타데이터가 라이선스 표현식을 선언하지 않았습니다.";
    case "Package metadata declares a malformed license expression.":
      return "패키지 메타데이터의 라이선스 표현식 형식이 올바르지 않습니다.";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk가 라이선스 표현식을 인식하지 못했습니다.";
    default:
      return finding.reason;
  }
}

function koreanFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "이 프로필에서는 추가 조치가 필요하지 않습니다.";
    case "Replace this package or escalate before shipping.":
      return "배포 전에 이 패키지를 교체하거나 검토 단계로 올리세요.";
    case "Do not ship this package until license permissions are clarified.":
      return "라이선스 허용 범위가 명확해질 때까지 이 패키지를 배포하지 마세요.";
    case NOTICE_ACTION:
      return "이 패키지를 배포할 때 필요한 NOTICE 또는 저작권 표시 파일을 유지하세요.";
    case "Review this package before shipping.":
      return "배포 전에 이 패키지를 검토하세요.";
    case "Keep this package out of production or scan with --prod.":
      return "이 패키지를 프로덕션에서 제외하거나 --prod로 다시 스캔하세요.";
    case "Add or verify package license metadata before approving this package.":
      return "이 패키지를 승인하기 전에 패키지 라이선스 메타데이터를 추가하거나 확인하세요.";
    case "Fix or manually review the declared license expression before approving this package.":
      return "이 패키지를 승인하기 전에 선언된 라이선스 표현식을 수정하거나 수동 검토하세요.";
    case "Collect license evidence before approving this package.":
      return "이 패키지를 승인하기 전에 라이선스 근거를 수집하세요.";
    default:
      return finding.action;
  }
}
