import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const KOREAN_TEXT: HtmlReportText = {
  htmlLang: "ko",
  title: "Ohrisk 스캔",
  labels: {
    action: "조치",
    activeFindings: "활성 발견 항목",
    dependency: "의존성",
    dependencies: "의존성",
    evidence: "근거",
    evidenceDetail: "근거",
    evidenceRecovery: "근거 보강",
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
    evidenceRecovery: koreanEvidenceRecovery,
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

function koreanEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `불명 ${advice.unknownFindings}개 중 ${advice.localEvidenceMissingFindings}개`;
  const prefix = `불명 항목 다수가 로컬 패키지 소스/캐시 근거 부족으로 보입니다(${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${koreanEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} 가능하면 전체 앱 빌드 대신 의존성 복원만 먼저 실행한 뒤 Ohrisk를 다시 실행하세요. 다른 생태계 예시는 npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle 의존성 해석, Python 가상환경 설치, dart pub get, swift package resolve입니다.`;
}

function koreanEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "스캔 루트" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? ` ${hint.sourceFileLabel}가 있는 폴더` : "해당 폴더";
    return `${source}(${directory})에서 ${hint.command}을 실행하세요. go.work에서는 Go 도구가 모듈을 요구하면 use에 적힌 모듈 폴더에서 실행하세요.`;
  }

  return `${directory}에서 ${hint.command}을 실행하세요.`;
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
