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
export type EvidenceRecoveryAdvice = {
  unknownFindings: number;
  localEvidenceMissingFindings: number;
  primaryHint?: EvidenceRecoveryHint;
};
export type EvidenceRecoveryHint = {
  ecosystem: "go" | "generic";
  command: string;
  directoryLabel: string;
  directoryIsScanRoot: boolean;
  sourceFileLabel?: string;
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
    evidenceRecovery: string;
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
    evidenceRecovery: (advice: EvidenceRecoveryAdvice) => string;
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
    evidenceRecovery: "Evidence recovery",
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
    evidenceRecovery: englishEvidenceRecovery,
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

const SPANISH_TEXT: HtmlReportText = {
  htmlLang: "es",
  title: "Escaneo de Ohrisk",
  labels: {
    action: "Acción",
    activeFindings: "Hallazgos activos",
    dependency: "Dependencia",
    dependencies: "Dependencias",
    evidence: "Evidencia",
    evidenceDetail: "Evidencia",
    evidenceRecovery: "Recuperación de evidencia",
    expiresOn: "Caduca el",
    expiredWaivers: "Excepciones caducadas",
    findingPath: "Ruta",
    findings: "Hallazgos",
    fingerprint: "Huella",
    licenseConfidence: "Confianza de licencia",
    licenseIssues: "Problemas de licencia",
    lockfile: "Lockfile",
    matchedBy: "Coincidencia",
    next: "Siguiente",
    package: "Paquete",
    path: "Ruta",
    prodOnly: "Solo producción",
    profile: "Perfil",
    project: "Proyecto",
    reason: "Motivo",
    reviewFocus: "Foco de revisión",
    reviewSummary: "Resumen de revisión",
    risks: "Riesgos",
    scope: "Alcance",
    search: "Buscar",
    severity: "Severidad",
    status: "Estado",
    summary: "Resumen",
    target: "Objetivo",
    threshold: "Umbral",
    unmatchedWaivers: "Excepciones sin coincidencia",
    waiverDrift: "Desviación de excepciones",
    waiverMode: "Modo de excepciones",
    waived: "Exceptuados",
    waivedFindings: "Hallazgos exceptuados",
    waivers: "Excepciones"
  },
  messages: {
    allActions: "Todas las acciones",
    allDependencies: "Todas las dependencias",
    collapseText: "Menos",
    defaultCollapseLabel: "Contraer valor",
    defaultExpandLabel: "Mostrar valor completo",
    searchPlaceholder: "Paquete, motivo, evidencia",
    noActiveFindings: "No hay hallazgos activos.",
    noExpiredWaivers: "No hay excepciones caducadas.",
    noMatchingFindings: "No hay hallazgos que coincidan con los filtros seleccionados.",
    noUnmatchedWaivers: "No hay excepciones sin coincidencia.",
    noWaivedFindings: "No hay hallazgos exceptuados.",
    waiverMode: (mode) =>
      mode === "ignored" ? "ignorado (--no-waivers)" : "local (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `${total} en total, ${direct} directas, ${transitive} transitivas`,
    evidence: (files, warnings) => `${files} archivos, ${warnings} advertencias`,
    licenseConfidence: (high, medium, low) =>
      `${high} de alta confianza, ${medium} de confianza media, ${low} de baja confianza`,
    licenseIssues: (missing, malformed) => `${missing} faltantes, ${malformed} mal formadas`,
    risks: (risks) =>
      `${risks.high} altos, ${risks.review} revisión, ${risks.unknown} desconocidos, ${risks.low} bajos`,
    waived: (applied, expired, unmatched) =>
      `${applied} aplicadas, ${expired} caducadas, ${unmatched} sin coincidencia`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "Se requiere revisión de alto riesgo";
      if (risks.unknown > 0) return "Se requiere revisión de evidencia";
      if (risks.review > 0) return "Se requiere revisión de política";
      if (risks.low > 0) return "Solo hallazgos de bajo riesgo";
      return "No hay hallazgos activos";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} activos (${risks.high} altos, ${risks.review} revisión, ${risks.unknown} desconocidos, ${risks.low} bajos)`;
    },
    scope: (profile, prodOnly) =>
      `perfil ${profile}, ${prodOnly ? "solo dependencias de producción" : "todas las dependencias"}`,
    reviewWaivers: (applied, driftEntries) =>
      `${applied} aplicadas, ${driftEntries} desviaciones`,
    reviewWaiverDrift: (summary) => {
      const line = spanishWaiverDrift(summary);
      return line?.replace(/^Desviación de excepciones: /, "") ?? "No comprobado (--strict-waivers no configurado)";
    },
    evidenceRecovery: spanishEvidenceRecovery,
    threshold: spanishThreshold,
    waiverDrift: spanishWaiverDrift,
    nextAction: spanishNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "alto";
        case "review":
          return "revisión";
        case "unknown":
          return "desconocido";
        case "low":
          return "bajo";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "reemplazar";
        case "review":
          return "revisar";
        case "collect-evidence":
          return "recopilar evidencia";
        case "exclude-dev-only":
          return "excluir solo desarrollo";
        case "allow":
          return "permitir";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "directa" : "transitiva"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "producción";
        case "development":
          return "desarrollo";
        case "optional":
          return "opcional";
        case "peer":
          return "peer";
        case "unknown":
          return "desconocida";
      }
    },
    dependencyContext: (finding) =>
      `${SPANISH_TEXT.messages.dependencyType(finding.dependencyType)} ${SPANISH_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: spanishFindingReason,
    findingAction: spanishFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `huella: ${waiver.fingerprint ?? "desconocida"}`,
    expandLabel: (label) => `Mostrar ${label} completo`,
    collapseLabel: (label) => `Contraer ${label}`,
    filterStatusTemplate: "{visible} de {total} hallazgos mostrados"
  },
  captions: {
    waivedFindings: "Hallazgos suprimidos por excepciones locales",
    expiredWaivers: "Excepciones locales caducadas",
    unmatchedWaivers: "Excepciones activas que no coincidieron con hallazgos actuales"
  }
};

const FRENCH_TEXT: HtmlReportText = {
  htmlLang: "fr",
  title: "Analyse Ohrisk",
  labels: {
    action: "Action",
    activeFindings: "Résultats actifs",
    dependency: "Dépendance",
    dependencies: "Dépendances",
    evidence: "Évidence",
    evidenceDetail: "Évidence",
    evidenceRecovery: "Récupération de l'évidence",
    expiresOn: "Expire le",
    expiredWaivers: "Exceptions expirées",
    findingPath: "Chemin",
    findings: "Résultats",
    fingerprint: "Empreinte",
    licenseConfidence: "Confiance de licence",
    licenseIssues: "Problèmes de licence",
    lockfile: "Lockfile",
    matchedBy: "Correspondance",
    next: "Suivant",
    package: "Paquet",
    path: "Chemin",
    prodOnly: "Production uniquement",
    profile: "Profil",
    project: "Projet",
    reason: "Motif",
    reviewFocus: "Point de revue",
    reviewSummary: "Résumé de revue",
    risks: "Risques",
    scope: "Portée",
    search: "Rechercher",
    severity: "Sévérité",
    status: "Statut",
    summary: "Résumé",
    target: "Cible",
    threshold: "Seuil",
    unmatchedWaivers: "Exceptions sans correspondance",
    waiverDrift: "Dérive des exceptions",
    waiverMode: "Mode d'exception",
    waived: "Exceptés",
    waivedFindings: "Résultats exceptés",
    waivers: "Exceptions"
  },
  messages: {
    allActions: "Toutes les actions",
    allDependencies: "Toutes les dépendances",
    collapseText: "Moins",
    defaultCollapseLabel: "Réduire la valeur",
    defaultExpandLabel: "Afficher la valeur complète",
    searchPlaceholder: "Paquet, motif, évidence",
    noActiveFindings: "Aucun résultat actif.",
    noExpiredWaivers: "Aucune exception expirée.",
    noMatchingFindings: "Aucun résultat ne correspond aux filtres sélectionnés.",
    noUnmatchedWaivers: "Aucune exception sans correspondance.",
    noWaivedFindings: "Aucun résultat excepté.",
    waiverMode: (mode) =>
      mode === "ignored" ? "ignoré (--no-waivers)" : "local (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `${total} au total, ${direct} directes, ${transitive} transitives`,
    evidence: (files, warnings) => `${files} fichiers, ${warnings} avertissements`,
    licenseConfidence: (high, medium, low) =>
      `${high} confiance élevée, ${medium} confiance moyenne, ${low} confiance faible`,
    licenseIssues: (missing, malformed) => `${missing} manquantes, ${malformed} mal formées`,
    risks: (risks) =>
      `${risks.high} élevés, ${risks.review} revue, ${risks.unknown} inconnus, ${risks.low} faibles`,
    waived: (applied, expired, unmatched) =>
      `${applied} appliquées, ${expired} expirées, ${unmatched} sans correspondance`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "Revue de risque élevé requise";
      if (risks.unknown > 0) return "Revue de l'évidence requise";
      if (risks.review > 0) return "Revue de politique requise";
      if (risks.low > 0) return "Résultats de faible risque seulement";
      return "Aucun résultat actif";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} actifs (${risks.high} élevés, ${risks.review} revue, ${risks.unknown} inconnus, ${risks.low} faibles)`;
    },
    scope: (profile, prodOnly) =>
      `profil ${profile}, ${prodOnly ? "dépendances de production uniquement" : "toutes les dépendances"}`,
    reviewWaivers: (applied, driftEntries) =>
      `${applied} appliquées, ${driftEntries} dérives`,
    reviewWaiverDrift: (summary) => {
      const line = frenchWaiverDrift(summary);
      return line?.replace(/^Dérive des exceptions: /, "") ?? "Non vérifié (--strict-waivers non configuré)";
    },
    evidenceRecovery: frenchEvidenceRecovery,
    threshold: frenchThreshold,
    waiverDrift: frenchWaiverDrift,
    nextAction: frenchNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "élevé";
        case "review":
          return "revue";
        case "unknown":
          return "inconnu";
        case "low":
          return "faible";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "remplacer";
        case "review":
          return "revoir";
        case "collect-evidence":
          return "collecter l'évidence";
        case "exclude-dev-only":
          return "exclure le développement";
        case "allow":
          return "autoriser";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "directe" : "transitive"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "production";
        case "development":
          return "développement";
        case "optional":
          return "optionnelle";
        case "peer":
          return "peer";
        case "unknown":
          return "inconnue";
      }
    },
    dependencyContext: (finding) =>
      `${FRENCH_TEXT.messages.dependencyType(finding.dependencyType)} ${FRENCH_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: frenchFindingReason,
    findingAction: frenchFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `empreinte: ${waiver.fingerprint ?? "inconnue"}`,
    expandLabel: (label) => `Afficher ${label} complet`,
    collapseLabel: (label) => `Réduire ${label}`,
    filterStatusTemplate: "{visible} résultats sur {total} affichés"
  },
  captions: {
    waivedFindings: "Résultats supprimés par des exceptions locales",
    expiredWaivers: "Entrées d'exception locale expirées",
    unmatchedWaivers: "Exceptions actives sans correspondance avec les résultats actuels"
  }
};

const CHINESE_TEXT: HtmlReportText = {
  htmlLang: "zh",
  title: "Ohrisk 扫描",
  labels: {
    action: "操作",
    activeFindings: "活动发现",
    dependency: "依赖",
    dependencies: "依赖",
    evidence: "证据",
    evidenceDetail: "证据",
    evidenceRecovery: "证据恢复",
    expiresOn: "到期日",
    expiredWaivers: "已过期豁免",
    findingPath: "路径",
    findings: "发现",
    fingerprint: "指纹",
    licenseConfidence: "许可证置信度",
    licenseIssues: "许可证问题",
    lockfile: "锁文件",
    matchedBy: "匹配依据",
    next: "下一步",
    package: "包",
    path: "路径",
    prodOnly: "仅生产",
    profile: "配置档",
    project: "项目",
    reason: "原因",
    reviewFocus: "审查重点",
    reviewSummary: "审查摘要",
    risks: "风险",
    scope: "范围",
    search: "搜索",
    severity: "严重性",
    status: "状态",
    summary: "摘要",
    target: "目标",
    threshold: "阈值",
    unmatchedWaivers: "未匹配豁免",
    waiverDrift: "豁免漂移",
    waiverMode: "豁免模式",
    waived: "已豁免",
    waivedFindings: "已豁免发现",
    waivers: "豁免"
  },
  messages: {
    allActions: "所有操作",
    allDependencies: "所有依赖",
    collapseText: "收起",
    defaultCollapseLabel: "收起值",
    defaultExpandLabel: "显示完整值",
    searchPlaceholder: "包、原因、证据",
    noActiveFindings: "没有活动发现。",
    noExpiredWaivers: "没有已过期豁免。",
    noMatchingFindings: "没有发现匹配所选筛选条件。",
    noUnmatchedWaivers: "没有未匹配豁免。",
    noWaivedFindings: "没有已豁免发现。",
    waiverMode: (mode) =>
      mode === "ignored" ? "已忽略 (--no-waivers)" : "本地 (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `共 ${total} 个，直接 ${direct} 个，传递 ${transitive} 个`,
    evidence: (files, warnings) => `${files} 个文件，${warnings} 个警告`,
    licenseConfidence: (high, medium, low) =>
      `高置信度 ${high} 个，中置信度 ${medium} 个，低置信度 ${low} 个`,
    licenseIssues: (missing, malformed) => `缺失 ${missing} 个，格式错误 ${malformed} 个`,
    risks: (risks) =>
      `高 ${risks.high} 个，需审查 ${risks.review} 个，未知 ${risks.unknown} 个，低 ${risks.low} 个`,
    waived: (applied, expired, unmatched) =>
      `已应用 ${applied} 个，已过期 ${expired} 个，未匹配 ${unmatched} 个`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "需要高风险审查";
      if (risks.unknown > 0) return "需要证据审查";
      if (risks.review > 0) return "需要策略审查";
      if (risks.low > 0) return "仅有低风险发现";
      return "没有活动发现";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} 个活动发现（高 ${risks.high} 个，需审查 ${risks.review} 个，未知 ${risks.unknown} 个，低 ${risks.low} 个）`;
    },
    scope: (profile, prodOnly) =>
      `${profile} 配置档，${prodOnly ? "仅生产依赖" : "所有依赖"}`,
    reviewWaivers: (applied, driftEntries) =>
      `已应用 ${applied} 个，漂移条目 ${driftEntries} 个`,
    reviewWaiverDrift: (summary) => {
      const line = chineseWaiverDrift(summary);
      return line?.replace(/^豁免漂移: /, "") ?? "未检查（未设置 --strict-waivers）";
    },
    evidenceRecovery: chineseEvidenceRecovery,
    threshold: chineseThreshold,
    waiverDrift: chineseWaiverDrift,
    nextAction: chineseNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "高";
        case "review":
          return "需审查";
        case "unknown":
          return "未知";
        case "low":
          return "低";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "替换";
        case "review":
          return "审查";
        case "collect-evidence":
          return "收集证据";
        case "exclude-dev-only":
          return "排除开发依赖";
        case "allow":
          return "允许";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "直接" : "传递"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "生产";
        case "development":
          return "开发";
        case "optional":
          return "可选";
        case "peer":
          return "peer";
        case "unknown":
          return "未知";
      }
    },
    dependencyContext: (finding) =>
      `${CHINESE_TEXT.messages.dependencyType(finding.dependencyType)} ${CHINESE_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: chineseFindingReason,
    findingAction: chineseFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `指纹: ${waiver.fingerprint ?? "未知"}`,
    expandLabel: (label) => `显示完整${label}`,
    collapseLabel: (label) => `收起${label}`,
    filterStatusTemplate: "显示 {visible} / {total} 个发现"
  },
  captions: {
    waivedFindings: "由本地豁免抑制的发现",
    expiredWaivers: "已过期的本地豁免条目",
    unmatchedWaivers: "未匹配当前发现的活动豁免条目"
  }
};

const HINDI_TEXT: HtmlReportText = {
  htmlLang: "hi",
  title: "Ohrisk स्कैन",
  labels: {
    action: "कार्रवाई",
    activeFindings: "सक्रिय निष्कर्ष",
    dependency: "निर्भरता",
    dependencies: "निर्भरताएँ",
    evidence: "साक्ष्य",
    evidenceDetail: "साक्ष्य",
    evidenceRecovery: "साक्ष्य पुनर्प्राप्ति",
    expiresOn: "समाप्ति तिथि",
    expiredWaivers: "समाप्त छूट",
    findingPath: "पथ",
    findings: "निष्कर्ष",
    fingerprint: "फिंगरप्रिंट",
    licenseConfidence: "लाइसेंस भरोसा",
    licenseIssues: "लाइसेंस समस्याएँ",
    lockfile: "लॉकफाइल",
    matchedBy: "मिलान आधार",
    next: "अगला",
    package: "पैकेज",
    path: "पथ",
    prodOnly: "केवल उत्पादन",
    profile: "प्रोफ़ाइल",
    project: "प्रोजेक्ट",
    reason: "कारण",
    reviewFocus: "समीक्षा केंद्र",
    reviewSummary: "समीक्षा सारांश",
    risks: "जोखिम",
    scope: "दायरा",
    search: "खोज",
    severity: "गंभीरता",
    status: "स्थिति",
    summary: "सारांश",
    target: "लक्ष्य",
    threshold: "सीमा",
    unmatchedWaivers: "बेमेल छूट",
    waiverDrift: "छूट विचलन",
    waiverMode: "छूट मोड",
    waived: "छूट प्राप्त",
    waivedFindings: "छूट प्राप्त निष्कर्ष",
    waivers: "छूट"
  },
  messages: {
    allActions: "सभी कार्रवाइयाँ",
    allDependencies: "सभी निर्भरताएँ",
    collapseText: "कम",
    defaultCollapseLabel: "मान समेटें",
    defaultExpandLabel: "पूरा मान दिखाएँ",
    searchPlaceholder: "पैकेज, कारण, साक्ष्य",
    noActiveFindings: "कोई सक्रिय निष्कर्ष नहीं।",
    noExpiredWaivers: "कोई समाप्त छूट नहीं।",
    noMatchingFindings: "चुने गए फ़िल्टर से कोई निष्कर्ष मेल नहीं खाता।",
    noUnmatchedWaivers: "कोई बेमेल छूट नहीं।",
    noWaivedFindings: "कोई छूट प्राप्त निष्कर्ष नहीं।",
    waiverMode: (mode) =>
      mode === "ignored" ? "अनदेखा (--no-waivers)" : "स्थानीय (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `कुल ${total}, प्रत्यक्ष ${direct}, पारगामी ${transitive}`,
    evidence: (files, warnings) => `${files} फ़ाइलें, ${warnings} चेतावनियाँ`,
    licenseConfidence: (high, medium, low) =>
      `${high} उच्च भरोसा, ${medium} मध्यम भरोसा, ${low} कम भरोसा`,
    licenseIssues: (missing, malformed) => `${missing} अनुपस्थित, ${malformed} गलत प्रारूप`,
    risks: (risks) =>
      `${risks.high} उच्च, ${risks.review} समीक्षा, ${risks.unknown} अज्ञात, ${risks.low} कम`,
    waived: (applied, expired, unmatched) =>
      `${applied} लागू, ${expired} समाप्त, ${unmatched} बेमेल`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "उच्च जोखिम समीक्षा आवश्यक";
      if (risks.unknown > 0) return "साक्ष्य समीक्षा आवश्यक";
      if (risks.review > 0) return "नीति समीक्षा आवश्यक";
      if (risks.low > 0) return "केवल कम जोखिम निष्कर्ष";
      return "कोई सक्रिय निष्कर्ष नहीं";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} सक्रिय (${risks.high} उच्च, ${risks.review} समीक्षा, ${risks.unknown} अज्ञात, ${risks.low} कम)`;
    },
    scope: (profile, prodOnly) =>
      `${profile} प्रोफ़ाइल, ${prodOnly ? "केवल उत्पादन निर्भरताएँ" : "सभी निर्भरताएँ"}`,
    reviewWaivers: (applied, driftEntries) =>
      `${applied} लागू, ${driftEntries} विचलन प्रविष्टियाँ`,
    reviewWaiverDrift: (summary) => {
      const line = hindiWaiverDrift(summary);
      return line?.replace(/^छूट विचलन: /, "") ?? "जाँचा नहीं गया (--strict-waivers सेट नहीं)";
    },
    evidenceRecovery: hindiEvidenceRecovery,
    threshold: hindiThreshold,
    waiverDrift: hindiWaiverDrift,
    nextAction: hindiNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "उच्च";
        case "review":
          return "समीक्षा";
        case "unknown":
          return "अज्ञात";
        case "low":
          return "कम";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "बदलें";
        case "review":
          return "समीक्षा करें";
        case "collect-evidence":
          return "साक्ष्य इकट्ठा करें";
        case "exclude-dev-only":
          return "केवल विकास हटाएँ";
        case "allow":
          return "अनुमति दें";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "प्रत्यक्ष" : "पारगामी"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "उत्पादन";
        case "development":
          return "विकास";
        case "optional":
          return "वैकल्पिक";
        case "peer":
          return "peer";
        case "unknown":
          return "अज्ञात";
      }
    },
    dependencyContext: (finding) =>
      `${HINDI_TEXT.messages.dependencyType(finding.dependencyType)} ${HINDI_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: hindiFindingReason,
    findingAction: hindiFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `फिंगरप्रिंट: ${waiver.fingerprint ?? "अज्ञात"}`,
    expandLabel: (label) => `पूरा ${label} दिखाएँ`,
    collapseLabel: (label) => `${label} समेटें`,
    filterStatusTemplate: "{total} में से {visible} निष्कर्ष दिखाए गए"
  },
  captions: {
    waivedFindings: "स्थानीय छूट से दबाए गए निष्कर्ष",
    expiredWaivers: "समाप्त स्थानीय छूट प्रविष्टियाँ",
    unmatchedWaivers: "वर्तमान निष्कर्षों से मेल न खाने वाली सक्रिय छूट प्रविष्टियाँ"
  }
};

const JAPANESE_TEXT: HtmlReportText = {
  htmlLang: "ja",
  title: "Ohrisk スキャン",
  labels: {
    action: "対応",
    activeFindings: "有効な検出",
    dependency: "依存関係",
    dependencies: "依存関係",
    evidence: "根拠",
    evidenceDetail: "根拠",
    evidenceRecovery: "根拠の復元",
    expiresOn: "期限",
    expiredWaivers: "期限切れの免除",
    findingPath: "パス",
    findings: "検出",
    fingerprint: "フィンガープリント",
    licenseConfidence: "ライセンス信頼度",
    licenseIssues: "ライセンス問題",
    lockfile: "ロックファイル",
    matchedBy: "一致条件",
    next: "次の対応",
    package: "パッケージ",
    path: "パス",
    prodOnly: "本番のみ",
    profile: "プロファイル",
    project: "プロジェクト",
    reason: "理由",
    reviewFocus: "レビュー対象",
    reviewSummary: "レビュー概要",
    risks: "リスク",
    scope: "範囲",
    search: "検索",
    severity: "重要度",
    status: "状態",
    summary: "概要",
    target: "対象",
    threshold: "しきい値",
    unmatchedWaivers: "未一致の免除",
    waiverDrift: "免除のずれ",
    waiverMode: "免除モード",
    waived: "免除済み",
    waivedFindings: "免除済みの検出",
    waivers: "免除"
  },
  messages: {
    allActions: "すべての対応",
    allDependencies: "すべての依存関係",
    collapseText: "閉じる",
    defaultCollapseLabel: "値を閉じる",
    defaultExpandLabel: "値をすべて表示",
    searchPlaceholder: "パッケージ、理由、根拠",
    noActiveFindings: "有効な検出はありません。",
    noExpiredWaivers: "期限切れの免除はありません。",
    noMatchingFindings: "選択したフィルターに一致する検出はありません。",
    noUnmatchedWaivers: "未一致の免除はありません。",
    noWaivedFindings: "免除済みの検出はありません。",
    waiverMode: (mode) =>
      mode === "ignored" ? "無視 (--no-waivers)" : "ローカル (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `合計 ${total}、直接 ${direct}、推移 ${transitive}`,
    evidence: (files, warnings) => `${files} ファイル、${warnings} 警告`,
    licenseConfidence: (high, medium, low) =>
      `高信頼 ${high}、中信頼 ${medium}、低信頼 ${low}`,
    licenseIssues: (missing, malformed) => `不足 ${missing}、形式不正 ${malformed}`,
    risks: (risks) =>
      `高 ${risks.high}、レビュー ${risks.review}、不明 ${risks.unknown}、低 ${risks.low}`,
    waived: (applied, expired, unmatched) =>
      `適用済み ${applied}、期限切れ ${expired}、未一致 ${unmatched}`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "高リスクレビューが必要";
      if (risks.unknown > 0) return "根拠レビューが必要";
      if (risks.review > 0) return "ポリシーレビューが必要";
      if (risks.low > 0) return "低リスクの検出のみ";
      return "有効な検出なし";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} 件有効 (高 ${risks.high}、レビュー ${risks.review}、不明 ${risks.unknown}、低 ${risks.low})`;
    },
    scope: (profile, prodOnly) =>
      `${profile} プロファイル、${prodOnly ? "本番依存関係のみ" : "すべての依存関係"}`,
    reviewWaivers: (applied, driftEntries) =>
      `適用済み ${applied}、ずれ ${driftEntries}`,
    reviewWaiverDrift: (summary) => {
      const line = japaneseWaiverDrift(summary);
      return line?.replace(/^免除のずれ: /, "") ?? "未確認 (--strict-waivers 未設定)";
    },
    evidenceRecovery: japaneseEvidenceRecovery,
    threshold: japaneseThreshold,
    waiverDrift: japaneseWaiverDrift,
    nextAction: japaneseNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "高";
        case "review":
          return "レビュー";
        case "unknown":
          return "不明";
        case "low":
          return "低";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "置換";
        case "review":
          return "レビュー";
        case "collect-evidence":
          return "根拠収集";
        case "exclude-dev-only":
          return "開発依存を除外";
        case "allow":
          return "許可";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "直接" : "推移"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "本番";
        case "development":
          return "開発";
        case "optional":
          return "任意";
        case "peer":
          return "peer";
        case "unknown":
          return "不明";
      }
    },
    dependencyContext: (finding) =>
      `${JAPANESE_TEXT.messages.dependencyType(finding.dependencyType)} ${JAPANESE_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: japaneseFindingReason,
    findingAction: japaneseFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `フィンガープリント: ${waiver.fingerprint ?? "不明"}`,
    expandLabel: (label) => `${label}をすべて表示`,
    collapseLabel: (label) => `${label}を閉じる`,
    filterStatusTemplate: "{total} 件中 {visible} 件を表示"
  },
  captions: {
    waivedFindings: "ローカル免除で抑制された検出",
    expiredWaivers: "期限切れのローカル免除エントリ",
    unmatchedWaivers: "現在の検出と一致しない有効な免除エントリ"
  }
};

const INDONESIAN_TEXT: HtmlReportText = {
  htmlLang: "id",
  title: "Pemindaian Ohrisk",
  labels: {
    action: "Tindakan",
    activeFindings: "Temuan aktif",
    dependency: "Dependensi",
    dependencies: "Dependensi",
    evidence: "Bukti",
    evidenceDetail: "Bukti",
    evidenceRecovery: "Pemulihan bukti",
    expiresOn: "Berakhir pada",
    expiredWaivers: "Waiver kedaluwarsa",
    findingPath: "Jalur",
    findings: "Temuan",
    fingerprint: "Fingerprint",
    licenseConfidence: "Keyakinan lisensi",
    licenseIssues: "Masalah lisensi",
    lockfile: "Lockfile",
    matchedBy: "Cocok berdasarkan",
    next: "Berikutnya",
    package: "Paket",
    path: "Jalur",
    prodOnly: "Hanya produksi",
    profile: "Profil",
    project: "Proyek",
    reason: "Alasan",
    reviewFocus: "Fokus review",
    reviewSummary: "Ringkasan review",
    risks: "Risiko",
    scope: "Cakupan",
    search: "Cari",
    severity: "Keparahan",
    status: "Status",
    summary: "Ringkasan",
    target: "Target",
    threshold: "Ambang",
    unmatchedWaivers: "Waiver tidak cocok",
    waiverDrift: "Drift waiver",
    waiverMode: "Mode waiver",
    waived: "Di-waive",
    waivedFindings: "Temuan di-waive",
    waivers: "Waiver"
  },
  messages: {
    allActions: "Semua tindakan",
    allDependencies: "Semua dependensi",
    collapseText: "Lebih sedikit",
    defaultCollapseLabel: "Ciutkan nilai",
    defaultExpandLabel: "Tampilkan nilai lengkap",
    searchPlaceholder: "Paket, alasan, bukti",
    noActiveFindings: "Tidak ada temuan aktif.",
    noExpiredWaivers: "Tidak ada waiver kedaluwarsa.",
    noMatchingFindings: "Tidak ada temuan yang cocok dengan filter terpilih.",
    noUnmatchedWaivers: "Tidak ada waiver yang tidak cocok.",
    noWaivedFindings: "Tidak ada temuan yang di-waive.",
    waiverMode: (mode) =>
      mode === "ignored" ? "diabaikan (--no-waivers)" : "lokal (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `${total} total, ${direct} langsung, ${transitive} transitif`,
    evidence: (files, warnings) => `${files} file, ${warnings} peringatan`,
    licenseConfidence: (high, medium, low) =>
      `${high} keyakinan tinggi, ${medium} keyakinan sedang, ${low} keyakinan rendah`,
    licenseIssues: (missing, malformed) => `${missing} hilang, ${malformed} salah format`,
    risks: (risks) =>
      `${risks.high} tinggi, ${risks.review} review, ${risks.unknown} tidak diketahui, ${risks.low} rendah`,
    waived: (applied, expired, unmatched) =>
      `${applied} diterapkan, ${expired} kedaluwarsa, ${unmatched} tidak cocok`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "Review risiko tinggi diperlukan";
      if (risks.unknown > 0) return "Review bukti diperlukan";
      if (risks.review > 0) return "Review kebijakan diperlukan";
      if (risks.low > 0) return "Hanya temuan risiko rendah";
      return "Tidak ada temuan aktif";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} aktif (${risks.high} tinggi, ${risks.review} review, ${risks.unknown} tidak diketahui, ${risks.low} rendah)`;
    },
    scope: (profile, prodOnly) =>
      `profil ${profile}, ${prodOnly ? "hanya dependensi produksi" : "semua dependensi"}`,
    reviewWaivers: (applied, driftEntries) =>
      `${applied} diterapkan, ${driftEntries} entri drift`,
    reviewWaiverDrift: (summary) => {
      const line = indonesianWaiverDrift(summary);
      return line?.replace(/^Drift waiver: /, "") ?? "Tidak diperiksa (--strict-waivers tidak disetel)";
    },
    evidenceRecovery: indonesianEvidenceRecovery,
    threshold: indonesianThreshold,
    waiverDrift: indonesianWaiverDrift,
    nextAction: indonesianNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "tinggi";
        case "review":
          return "review";
        case "unknown":
          return "tidak diketahui";
        case "low":
          return "rendah";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "ganti";
        case "review":
          return "review";
        case "collect-evidence":
          return "kumpulkan bukti";
        case "exclude-dev-only":
          return "keluarkan dev-only";
        case "allow":
          return "izinkan";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "langsung" : "transitif"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "produksi";
        case "development":
          return "pengembangan";
        case "optional":
          return "opsional";
        case "peer":
          return "peer";
        case "unknown":
          return "tidak diketahui";
      }
    },
    dependencyContext: (finding) =>
      `${INDONESIAN_TEXT.messages.dependencyType(finding.dependencyType)} ${INDONESIAN_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: indonesianFindingReason,
    findingAction: indonesianFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `fingerprint: ${waiver.fingerprint ?? "tidak diketahui"}`,
    expandLabel: (label) => `Tampilkan ${label} lengkap`,
    collapseLabel: (label) => `Ciutkan ${label}`,
    filterStatusTemplate: "{visible} dari {total} temuan ditampilkan"
  },
  captions: {
    waivedFindings: "Temuan yang ditekan oleh waiver lokal",
    expiredWaivers: "Entri waiver lokal yang kedaluwarsa",
    unmatchedWaivers: "Entri waiver aktif yang tidak cocok dengan temuan saat ini"
  }
};

const TURKISH_TEXT: HtmlReportText = {
  htmlLang: "tr",
  title: "Ohrisk taraması",
  labels: {
    action: "Eylem",
    activeFindings: "Aktif bulgular",
    dependency: "Bağımlılık",
    dependencies: "Bağımlılıklar",
    evidence: "Kanıt",
    evidenceDetail: "Kanıt",
    evidenceRecovery: "Kanıt tamamlama",
    expiresOn: "Bitiş tarihi",
    expiredWaivers: "Süresi dolan muafiyetler",
    findingPath: "Yol",
    findings: "Bulgular",
    fingerprint: "Parmak izi",
    licenseConfidence: "Lisans güveni",
    licenseIssues: "Lisans sorunları",
    lockfile: "Lockfile",
    matchedBy: "Eşleşme ölçütü",
    next: "Sonraki",
    package: "Paket",
    path: "Yol",
    prodOnly: "Yalnızca üretim",
    profile: "Profil",
    project: "Proje",
    reason: "Neden",
    reviewFocus: "İnceleme odağı",
    reviewSummary: "İnceleme özeti",
    risks: "Riskler",
    scope: "Kapsam",
    search: "Ara",
    severity: "Önem",
    status: "Durum",
    summary: "Özet",
    target: "Hedef",
    threshold: "Eşik",
    unmatchedWaivers: "Eşleşmeyen muafiyetler",
    waiverDrift: "Muafiyet sapması",
    waiverMode: "Muafiyet modu",
    waived: "Muaf tutuldu",
    waivedFindings: "Muaf tutulan bulgular",
    waivers: "Muafiyetler"
  },
  messages: {
    allActions: "Tüm eylemler",
    allDependencies: "Tüm bağımlılıklar",
    collapseText: "Daha az",
    defaultCollapseLabel: "Değeri daralt",
    defaultExpandLabel: "Tam değeri göster",
    searchPlaceholder: "Paket, neden, kanıt",
    noActiveFindings: "Aktif bulgu yok.",
    noExpiredWaivers: "Süresi dolan muafiyet yok.",
    noMatchingFindings: "Seçili filtrelerle eşleşen bulgu yok.",
    noUnmatchedWaivers: "Eşleşmeyen muafiyet yok.",
    noWaivedFindings: "Muaf tutulan bulgu yok.",
    waiverMode: (mode) =>
      mode === "ignored" ? "yok sayıldı (--no-waivers)" : "yerel (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `${total} toplam, ${direct} doğrudan, ${transitive} geçişli`,
    evidence: (files, warnings) => `${files} dosya, ${warnings} uyarı`,
    licenseConfidence: (high, medium, low) =>
      `${high} yüksek güven, ${medium} orta güven, ${low} düşük güven`,
    licenseIssues: (missing, malformed) => `${missing} eksik, ${malformed} hatalı biçimli`,
    risks: (risks) =>
      `${risks.high} yüksek, ${risks.review} inceleme, ${risks.unknown} bilinmeyen, ${risks.low} düşük`,
    waived: (applied, expired, unmatched) =>
      `${applied} uygulandı, ${expired} süresi doldu, ${unmatched} eşleşmedi`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "Yüksek risk incelemesi gerekiyor";
      if (risks.unknown > 0) return "Kanıt incelemesi gerekiyor";
      if (risks.review > 0) return "Politika incelemesi gerekiyor";
      if (risks.low > 0) return "Yalnızca düşük riskli bulgular";
      return "Aktif bulgu yok";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} aktif (${risks.high} yüksek, ${risks.review} inceleme, ${risks.unknown} bilinmeyen, ${risks.low} düşük)`;
    },
    scope: (profile, prodOnly) =>
      `${profile} profili, ${prodOnly ? "yalnızca üretim bağımlılıkları" : "tüm bağımlılıklar"}`,
    reviewWaivers: (applied, driftEntries) =>
      `${applied} uygulandı, ${driftEntries} sapma girdisi`,
    reviewWaiverDrift: (summary) => {
      const line = turkishWaiverDrift(summary);
      return line?.replace(/^Muafiyet sapması: /, "") ?? "Kontrol edilmedi (--strict-waivers ayarlı değil)";
    },
    evidenceRecovery: turkishEvidenceRecovery,
    threshold: turkishThreshold,
    waiverDrift: turkishWaiverDrift,
    nextAction: turkishNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "yüksek";
        case "review":
          return "inceleme";
        case "unknown":
          return "bilinmeyen";
        case "low":
          return "düşük";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "değiştir";
        case "review":
          return "incele";
        case "collect-evidence":
          return "kanıt topla";
        case "exclude-dev-only":
          return "yalnızca geliştirmeyi hariç tut";
        case "allow":
          return "izin ver";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "doğrudan" : "geçişli"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "üretim";
        case "development":
          return "geliştirme";
        case "optional":
          return "isteğe bağlı";
        case "peer":
          return "peer";
        case "unknown":
          return "bilinmeyen";
      }
    },
    dependencyContext: (finding) =>
      `${TURKISH_TEXT.messages.dependencyType(finding.dependencyType)} ${TURKISH_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: turkishFindingReason,
    findingAction: turkishFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `parmak izi: ${waiver.fingerprint ?? "bilinmeyen"}`,
    expandLabel: (label) => `Tam ${label} göster`,
    collapseLabel: (label) => `${label} daralt`,
    filterStatusTemplate: "{visible} / {total} bulgu gösteriliyor"
  },
  captions: {
    waivedFindings: "Yerel muafiyetlerle bastırılan bulgular",
    expiredWaivers: "Süresi dolan yerel muafiyet girdileri",
    unmatchedWaivers: "Geçerli bulgularla eşleşmeyen aktif muafiyet girdileri"
  }
};

const RUSSIAN_TEXT: HtmlReportText = {
  htmlLang: "ru",
  title: "Сканирование Ohrisk",
  labels: {
    action: "Действие",
    activeFindings: "Активные находки",
    dependency: "Зависимость",
    dependencies: "Зависимости",
    evidence: "Доказательства",
    evidenceDetail: "Доказательства",
    evidenceRecovery: "Восстановление доказательств",
    expiresOn: "Истекает",
    expiredWaivers: "Просроченные исключения",
    findingPath: "Путь",
    findings: "Находки",
    fingerprint: "Отпечаток",
    licenseConfidence: "Уверенность в лицензии",
    licenseIssues: "Проблемы лицензий",
    lockfile: "Lockfile",
    matchedBy: "Совпало по",
    next: "Далее",
    package: "Пакет",
    path: "Путь",
    prodOnly: "Только production",
    profile: "Профиль",
    project: "Проект",
    reason: "Причина",
    reviewFocus: "Фокус проверки",
    reviewSummary: "Итоги проверки",
    risks: "Риски",
    scope: "Область",
    search: "Поиск",
    severity: "Серьезность",
    status: "Статус",
    summary: "Сводка",
    target: "Цель",
    threshold: "Порог",
    unmatchedWaivers: "Несовпавшие исключения",
    waiverDrift: "Дрифт исключений",
    waiverMode: "Режим исключений",
    waived: "Исключено",
    waivedFindings: "Исключенные находки",
    waivers: "Исключения"
  },
  messages: {
    allActions: "Все действия",
    allDependencies: "Все зависимости",
    collapseText: "Меньше",
    defaultCollapseLabel: "Свернуть значение",
    defaultExpandLabel: "Показать полное значение",
    searchPlaceholder: "Пакет, причина, доказательства",
    noActiveFindings: "Активных находок нет.",
    noExpiredWaivers: "Просроченных исключений нет.",
    noMatchingFindings: "Нет находок, соответствующих выбранным фильтрам.",
    noUnmatchedWaivers: "Несовпавших исключений нет.",
    noWaivedFindings: "Исключенных находок нет.",
    waiverMode: (mode) =>
      mode === "ignored" ? "игнорируются (--no-waivers)" : "локальные (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `всего ${total}, прямых ${direct}, транзитивных ${transitive}`,
    evidence: (files, warnings) => `${files} файлов, ${warnings} предупреждений`,
    licenseConfidence: (high, medium, low) =>
      `${high} с высокой уверенностью, ${medium} со средней уверенностью, ${low} с низкой уверенностью`,
    licenseIssues: (missing, malformed) => `${missing} отсутствует, ${malformed} с неверным форматом`,
    risks: (risks) =>
      `${risks.high} высокий, ${risks.review} проверка, ${risks.unknown} неизвестный, ${risks.low} низкий`,
    waived: (applied, expired, unmatched) =>
      `${applied} применено, ${expired} просрочено, ${unmatched} не совпало`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "Требуется проверка высокого риска";
      if (risks.unknown > 0) return "Требуется проверка доказательств";
      if (risks.review > 0) return "Требуется проверка политики";
      if (risks.low > 0) return "Только находки низкого риска";
      return "Активных находок нет";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} активных (${risks.high} высокий, ${risks.review} проверка, ${risks.unknown} неизвестный, ${risks.low} низкий)`;
    },
    scope: (profile, prodOnly) =>
      `профиль ${profile}, ${prodOnly ? "только production-зависимости" : "все зависимости"}`,
    reviewWaivers: (applied, driftEntries) =>
      `${applied} применено, ${driftEntries} записей дрифта`,
    reviewWaiverDrift: (summary) => {
      const line = russianWaiverDrift(summary);
      return line?.replace(/^Дрифт исключений: /, "") ?? "Не проверено (--strict-waivers не задан)";
    },
    evidenceRecovery: russianEvidenceRecovery,
    threshold: russianThreshold,
    waiverDrift: russianWaiverDrift,
    nextAction: russianNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "высокий";
        case "review":
          return "проверка";
        case "unknown":
          return "неизвестный";
        case "low":
          return "низкий";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "заменить";
        case "review":
          return "проверить";
        case "collect-evidence":
          return "собрать доказательства";
        case "exclude-dev-only":
          return "исключить dev-only";
        case "allow":
          return "разрешить";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "прямая" : "транзитивная"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "production";
        case "development":
          return "development";
        case "optional":
          return "optional";
        case "peer":
          return "peer";
        case "unknown":
          return "неизвестная";
      }
    },
    dependencyContext: (finding) =>
      `${RUSSIAN_TEXT.messages.dependencyType(finding.dependencyType)} ${RUSSIAN_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: russianFindingReason,
    findingAction: russianFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `отпечаток: ${waiver.fingerprint ?? "неизвестно"}`,
    expandLabel: (label) => `Показать полный ${label}`,
    collapseLabel: (label) => `Свернуть ${label}`,
    filterStatusTemplate: "показано {visible} из {total} находок"
  },
  captions: {
    waivedFindings: "Находки, подавленные локальными исключениями",
    expiredWaivers: "Просроченные локальные исключения",
    unmatchedWaivers: "Активные исключения, не совпавшие с текущими находками"
  }
};

const GERMAN_TEXT: HtmlReportText = {
  htmlLang: "de",
  title: "Ohrisk-Scan",
  labels: {
    action: "Aktion",
    activeFindings: "Aktive Befunde",
    dependency: "Abhängigkeit",
    dependencies: "Abhängigkeiten",
    evidence: "Nachweise",
    evidenceDetail: "Nachweis",
    evidenceRecovery: "Nachweise ergänzen",
    expiresOn: "Läuft ab am",
    expiredWaivers: "Abgelaufene Ausnahmen",
    findingPath: "Pfad",
    findings: "Befunde",
    fingerprint: "Fingerabdruck",
    licenseConfidence: "Lizenzsicherheit",
    licenseIssues: "Lizenzprobleme",
    lockfile: "Lockfile",
    matchedBy: "Abgeglichen über",
    next: "Nächster Schritt",
    package: "Paket",
    path: "Pfad",
    prodOnly: "Nur Produktion",
    profile: "Profil",
    project: "Projekt",
    reason: "Grund",
    reviewFocus: "Prüffokus",
    reviewSummary: "Prüfzusammenfassung",
    risks: "Risiken",
    scope: "Umfang",
    search: "Suchen",
    severity: "Schweregrad",
    status: "Status",
    summary: "Zusammenfassung",
    target: "Ziel",
    threshold: "Schwelle",
    unmatchedWaivers: "Nicht zugeordnete Ausnahmen",
    waiverDrift: "Ausnahmen-Drift",
    waiverMode: "Ausnahmenmodus",
    waived: "Ausgenommen",
    waivedFindings: "Ausgenommene Befunde",
    waivers: "Ausnahmen"
  },
  messages: {
    allActions: "Alle Aktionen",
    allDependencies: "Alle Abhängigkeiten",
    collapseText: "Weniger",
    defaultCollapseLabel: "Wert einklappen",
    defaultExpandLabel: "Vollständigen Wert anzeigen",
    searchPlaceholder: "Paket, Grund, Nachweis",
    noActiveFindings: "Keine aktiven Befunde.",
    noExpiredWaivers: "Keine abgelaufenen Ausnahmen.",
    noMatchingFindings: "Keine Befunde passen zu den ausgewählten Filtern.",
    noUnmatchedWaivers: "Keine nicht zugeordneten Ausnahmen.",
    noWaivedFindings: "Keine ausgenommenen Befunde.",
    waiverMode: (mode) =>
      mode === "ignored" ? "ignoriert (--no-waivers)" : "lokal (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `${total} insgesamt, ${direct} direkt, ${transitive} transitiv`,
    evidence: (files, warnings) => `${files} Dateien, ${warnings} Warnungen`,
    licenseConfidence: (high, medium, low) =>
      `${high} hohe Sicherheit, ${medium} mittlere Sicherheit, ${low} niedrige Sicherheit`,
    licenseIssues: (missing, malformed) => `${missing} fehlend, ${malformed} fehlerhaft formatiert`,
    risks: (risks) =>
      `${risks.high} hoch, ${risks.review} Prüfung, ${risks.unknown} unbekannt, ${risks.low} niedrig`,
    waived: (applied, expired, unmatched) =>
      `${applied} angewendet, ${expired} abgelaufen, ${unmatched} nicht zugeordnet`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "Prüfung hoher Risiken erforderlich";
      if (risks.unknown > 0) return "Nachweisprüfung erforderlich";
      if (risks.review > 0) return "Richtlinienprüfung erforderlich";
      if (risks.low > 0) return "Nur Befunde mit niedrigem Risiko";
      return "Keine aktiven Befunde";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} aktiv (${risks.high} hoch, ${risks.review} Prüfung, ${risks.unknown} unbekannt, ${risks.low} niedrig)`;
    },
    scope: (profile, prodOnly) =>
      `${profile}-Profil, ${prodOnly ? "nur Produktionsabhängigkeiten" : "alle Abhängigkeiten"}`,
    reviewWaivers: (applied, driftEntries) =>
      `${applied} angewendet, ${driftEntries} Drift-Einträge`,
    reviewWaiverDrift: (summary) => {
      const line = germanWaiverDrift(summary);
      return line?.replace(/^Ausnahmen-Drift: /, "") ?? "Nicht geprüft (--strict-waivers nicht gesetzt)";
    },
    evidenceRecovery: germanEvidenceRecovery,
    threshold: germanThreshold,
    waiverDrift: germanWaiverDrift,
    nextAction: germanNextAction,
    severity: (severity) => {
      switch (severity) {
        case "high":
          return "hoch";
        case "review":
          return "Prüfung";
        case "unknown":
          return "unbekannt";
        case "low":
          return "niedrig";
      }
    },
    recommendation: (recommendation) => {
      switch (recommendation) {
        case "replace":
          return "ersetzen";
        case "review":
          return "prüfen";
        case "collect-evidence":
          return "Nachweise sammeln";
        case "exclude-dev-only":
          return "nur Entwicklung ausschließen";
        case "allow":
          return "zulassen";
      }
    },
    dependencyScope: (scope) => (scope === "direct" ? "direkt" : "transitiv"),
    dependencyType: (type) => {
      switch (type) {
        case "production":
          return "Produktion";
        case "development":
          return "Entwicklung";
        case "optional":
          return "optional";
        case "peer":
          return "peer";
        case "unknown":
          return "unbekannt";
      }
    },
    dependencyContext: (finding) =>
      `${GERMAN_TEXT.messages.dependencyType(finding.dependencyType)} ${GERMAN_TEXT.messages.dependencyScope(finding.dependencyScope)}`,
    findingReason: germanFindingReason,
    findingAction: germanFindingAction,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `Fingerabdruck: ${waiver.fingerprint ?? "unbekannt"}`,
    expandLabel: (label) => `${label} vollständig anzeigen`,
    collapseLabel: (label) => `${label} einklappen`,
    filterStatusTemplate: "{visible} von {total} Befunden angezeigt"
  },
  captions: {
    waivedFindings: "Durch lokale Ausnahmen unterdrückte Befunde",
    expiredWaivers: "Abgelaufene lokale Ausnahme-Einträge",
    unmatchedWaivers: "Aktive Ausnahme-Einträge ohne Treffer in aktuellen Befunden"
  }
};

const HTML_REPORT_TEXT: Record<ReportLanguage, HtmlReportText> = {
  en: ENGLISH_TEXT,
  ko: KOREAN_TEXT,
  es: SPANISH_TEXT,
  fr: FRENCH_TEXT,
  zh: CHINESE_TEXT,
  hi: HINDI_TEXT,
  ja: JAPANESE_TEXT,
  id: INDONESIAN_TEXT,
  tr: TURKISH_TEXT,
  ru: RUSSIAN_TEXT,
  de: GERMAN_TEXT
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

function spanishThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "fallo" : "paso";
  const severity = SPANISH_TEXT.messages.severity(summary.failOn);
  return `Umbral: ${outcome} en ${severity} (${summary.failingFindingCount} hallazgos en o por encima del umbral)`;
}

function spanishWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "fallo" : "paso";
  return `Desviación de excepciones: ${status} (${summary.waiverDriftCount} excepciones caducadas o sin coincidencia)`;
}

function frenchThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "échec" : "réussite";
  const severity = FRENCH_TEXT.messages.severity(summary.failOn);
  return `Seuil: ${outcome} sur ${severity} (${summary.failingFindingCount} résultats au seuil ou au-dessus)`;
}

function frenchWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "échec" : "réussite";
  return `Dérive des exceptions: ${status} (${summary.waiverDriftCount} exceptions expirées ou sans correspondance)`;
}

function chineseThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "失败" : "通过";
  const severity = CHINESE_TEXT.messages.severity(summary.failOn);
  return `阈值: ${outcome} 于 ${severity} (${summary.failingFindingCount} 个发现达到或超过阈值)`;
}

function chineseWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "失败" : "通过";
  return `豁免漂移: ${status} (${summary.waiverDriftCount} 个已过期或未匹配的豁免)`;
}

function hindiThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "विफल" : "उत्तीर्ण";
  const severity = HINDI_TEXT.messages.severity(summary.failOn);
  return `सीमा: ${severity} पर ${outcome} (${summary.failingFindingCount} निष्कर्ष सीमा पर या उससे ऊपर)`;
}

function hindiWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "विफल" : "उत्तीर्ण";
  return `छूट विचलन: ${status} (${summary.waiverDriftCount} समाप्त या बेमेल छूट)`;
}

function japaneseThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "失敗" : "合格";
  const severity = JAPANESE_TEXT.messages.severity(summary.failOn);
  return `しきい値: ${severity} で ${outcome} (${summary.failingFindingCount} 件がしきい値以上)`;
}

function japaneseWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "失敗" : "合格";
  return `免除のずれ: ${status} (${summary.waiverDriftCount} 件の期限切れまたは未一致の免除)`;
}

function indonesianThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "gagal" : "lulus";
  const severity = INDONESIAN_TEXT.messages.severity(summary.failOn);
  return `Ambang: ${outcome} pada ${severity} (${summary.failingFindingCount} temuan pada atau di atas ambang)`;
}

function indonesianWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "gagal" : "lulus";
  return `Drift waiver: ${status} (${summary.waiverDriftCount} waiver kedaluwarsa atau tidak cocok)`;
}

function turkishThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "başarısız" : "geçti";
  const severity = TURKISH_TEXT.messages.severity(summary.failOn);
  return `Eşik: ${severity} için ${outcome} (${summary.failingFindingCount} bulgu eşikte veya üstünde)`;
}

function turkishWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "başarısız" : "geçti";
  return `Muafiyet sapması: ${status} (${summary.waiverDriftCount} süresi dolmuş veya eşleşmeyen muafiyet)`;
}

function russianThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "не пройден" : "пройден";
  const severity = RUSSIAN_TEXT.messages.severity(summary.failOn);
  return `Порог: ${outcome} на уровне ${severity} (${summary.failingFindingCount} находок на пороге или выше)`;
}

function russianWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "не пройден" : "пройден";
  return `Дрифт исключений: ${status} (${summary.waiverDriftCount} просроченных или несовпавших исключений)`;
}

function germanThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "fehlgeschlagen" : "bestanden";
  const severity = GERMAN_TEXT.messages.severity(summary.failOn);
  return `Schwelle: ${outcome} bei ${severity} (${summary.failingFindingCount} Befunde auf oder über der Schwelle)`;
}

function germanWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "fehlgeschlagen" : "bestanden";
  return `Ausnahmen-Drift: ${status} (${summary.waiverDriftCount} abgelaufene oder nicht zugeordnete Ausnahmen)`;
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

function englishEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} of ${advice.unknownFindings} unknown`;
  const prefix = `Many unknown findings look caused by missing local package source/cache evidence (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${englishEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} Restore dependencies without a full app build when possible, then rerun Ohrisk. Other ecosystem examples: npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle dependency resolution, Python virtualenv install, dart pub get, and swift package resolve.`;
}

function englishEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "scan root" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? ` containing ${hint.sourceFileLabel}` : "";
    return `Run ${hint.command} from the directory${source} (${directory}); for go.work, use a module listed by use if the Go toolchain asks for a module.`;
  }

  return `Run ${hint.command} from ${directory}.`;
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

function spanishNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Reemplaza o escala las dependencias de alto riesgo antes de publicar.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Recopila la evidencia de licencia faltante antes de aprobar este proyecto.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Revisa las dependencias marcadas antes de publicar con este perfil.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Ejecuta con --prod o mantén el riesgo de desarrollo fuera de producción.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Conserva los archivos NOTICE o de atribución requeridos al distribuir este proyecto.";
  }

  return "No se requiere acción para este perfil.";
}

function spanishEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} de ${advice.unknownFindings} desconocidos`;
  const prefix = `Muchos hallazgos desconocidos parecen venir de evidencia local de fuente/cache de paquetes faltante (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${spanishEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} Cuando sea posible, restaura dependencias antes de hacer una compilación completa de la app y vuelve a ejecutar Ohrisk. Otros ejemplos por ecosistema: npm/pnpm/Bun install, cargo fetch, dotnet restore, resolución de dependencias Maven/Gradle, instalación en virtualenv de Python, dart pub get y swift package resolve.`;
}

function spanishEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "raíz del escaneo" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? ` que contiene ${hint.sourceFileLabel}` : "";
    return `Ejecuta ${hint.command} desde el directorio${source} (${directory}); con go.work, usa un módulo listado en use si la herramienta Go pide un módulo.`;
  }

  return `Ejecuta ${hint.command} desde ${directory}.`;
}

function frenchNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Remplacez ou escaladez les dépendances à haut risque avant la publication.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Collectez l'évidence de licence manquante avant d'approuver ce projet.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Passez en revue les dépendances signalées avant de publier avec ce profil.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Exécutez avec --prod ou gardez le risque de développement hors production.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Conservez les fichiers NOTICE ou d'attribution requis lors de la distribution de ce projet.";
  }

  return "Aucune action requise pour ce profil.";
}

function frenchEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} sur ${advice.unknownFindings} inconnus`;
  const prefix = `De nombreux résultats inconnus semblent venir d'une évidence locale de source/cache de paquets manquante (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${frenchEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} Quand c'est possible, restaurez les dépendances avant une compilation complète de l'app, puis relancez Ohrisk. Autres exemples par écosystème: npm/pnpm/Bun install, cargo fetch, dotnet restore, résolution des dépendances Maven/Gradle, installation dans un virtualenv Python, dart pub get et swift package resolve.`;
}

function frenchEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "racine du scan" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? ` contenant ${hint.sourceFileLabel}` : "";
    return `Exécutez ${hint.command} depuis le répertoire${source} (${directory}); avec go.work, utilisez un module listé dans use si l'outil Go demande un module.`;
  }

  return `Exécutez ${hint.command} depuis ${directory}.`;
}

function chineseNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "发布前替换高风险依赖，或升级给负责人审查。";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "批准此项目之前，先收集缺失的许可证证据。";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "使用此配置档发布前，先审查标记的依赖。";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "使用 --prod 重新运行，或确保开发风险不会进入生产。";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "分发此项目时保留所需的 NOTICE 或署名文件。";
  }

  return "此配置档不需要进一步操作。";
}

function chineseEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} / ${advice.unknownFindings} 个未知`;
  const prefix = `许多未知发现看起来是由缺失的本地包源码/缓存证据造成的（${ratio}）。`;
  const primary = advice.primaryHint
    ? ` ${chineseEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} 尽可能先恢复依赖，而不是完整构建应用，然后重新运行 Ohrisk。其他生态示例: npm/pnpm/Bun install、cargo fetch、dotnet restore、Maven/Gradle 依赖解析、Python virtualenv install、dart pub get 和 swift package resolve。`;
}

function chineseEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "扫描根目录" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? `包含 ${hint.sourceFileLabel} 的目录` : "该目录";
    return `从${source}（${directory}）运行 ${hint.command}；如果 Go 工具链在 go.work 中要求模块，请使用 use 中列出的模块目录。`;
  }

  return `从 ${directory} 运行 ${hint.command}。`;
}

function hindiNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "रिलीज़ से पहले उच्च जोखिम निर्भरताएँ बदलें या समीक्षा के लिए आगे बढ़ाएँ।";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "इस प्रोजेक्ट को मंज़ूर करने से पहले अनुपस्थित लाइसेंस साक्ष्य इकट्ठा करें।";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "इस प्रोफ़ाइल में रिलीज़ से पहले चिह्नित निर्भरताओं की समीक्षा करें।";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "--prod के साथ चलाएँ या विकास जोखिम को उत्पादन से बाहर रखें।";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "इस प्रोजेक्ट को वितरित करते समय आवश्यक NOTICE या attribution फ़ाइलें बनाए रखें।";
  }

  return "इस प्रोफ़ाइल के लिए कोई कार्रवाई आवश्यक नहीं।";
}

function hindiEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} / ${advice.unknownFindings} अज्ञात`;
  const prefix = `कई अज्ञात निष्कर्ष अनुपस्थित स्थानीय पैकेज स्रोत/कैश साक्ष्य के कारण लगते हैं (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${hindiEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} संभव हो तो पूरा ऐप बिल्ड करने से पहले निर्भरताएँ restore करें, फिर Ohrisk दोबारा चलाएँ। अन्य ecosystem उदाहरण: npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle dependency resolution, Python virtualenv install, dart pub get, और swift package resolve।`;
}

function hindiEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "स्कैन रूट" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? `${hint.sourceFileLabel} वाले directory` : "उस directory";
    return `${source} (${directory}) से ${hint.command} चलाएँ; go.work में अगर Go toolchain module माँगे तो use में लिखे module directory का उपयोग करें।`;
  }

  return `${directory} से ${hint.command} चलाएँ।`;
}

function japaneseNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "リリース前に高リスク依存関係を置き換えるか、レビューにエスカレーションしてください。";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "このプロジェクトを承認する前に、不足しているライセンス根拠を収集してください。";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "このプロファイルでリリースする前に、フラグ付きの依存関係をレビューしてください。";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "--prod で実行するか、開発専用リスクを本番に入れないでください。";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "このプロジェクトを配布するときは、必要な NOTICE または attribution ファイルを保持してください。";
  }

  return "このプロファイルでは対応は不要です。";
}

function japaneseEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} / ${advice.unknownFindings} 件の不明`;
  const prefix = `多くの不明な検出は、ローカルのパッケージソース/キャッシュ根拠が不足していることが原因に見えます (${ratio})。`;
  const primary = advice.primaryHint
    ? ` ${japaneseEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} 可能ならアプリ全体をビルドする前に依存関係だけを復元し、その後 Ohrisk を再実行してください。その他の ecosystem 例: npm/pnpm/Bun install、cargo fetch、dotnet restore、Maven/Gradle dependency resolution、Python virtualenv install、dart pub get、swift package resolve。`;
}

function japaneseEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "スキャンルート" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? `${hint.sourceFileLabel} を含むディレクトリ` : "そのディレクトリ";
    return `${source} (${directory}) で ${hint.command} を実行してください。go.work で Go toolchain が module を要求する場合は、use に listed された module directory を使ってください。`;
  }

  return `${directory} で ${hint.command} を実行してください。`;
}

function indonesianNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Ganti dependensi berisiko tinggi atau eskalasikan untuk review sebelum rilis.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Kumpulkan bukti lisensi yang hilang sebelum menyetujui proyek ini.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Review dependensi yang ditandai sebelum rilis dengan profil ini.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Jalankan dengan --prod atau pastikan risiko dev-only tidak masuk produksi.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Pertahankan file NOTICE atau atribusi yang diperlukan saat mendistribusikan proyek ini.";
  }

  return "Tidak ada tindakan yang diperlukan untuk profil ini.";
}

function indonesianEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} / ${advice.unknownFindings} tidak diketahui`;
  const prefix = `Banyak temuan tidak diketahui tampaknya disebabkan oleh bukti source/cache paket lokal yang hilang (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${indonesianEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} Jika memungkinkan, restore dependensi sebelum melakukan build aplikasi penuh, lalu jalankan ulang Ohrisk. Contoh ecosystem lain: npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle dependency resolution, Python virtualenv install, dart pub get, dan swift package resolve.`;
}

function indonesianEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "root pemindaian" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? `direktori yang berisi ${hint.sourceFileLabel}` : "direktori tersebut";
    return `Jalankan ${hint.command} dari ${source} (${directory}); untuk go.work, gunakan direktori module yang tercantum di use jika Go toolchain meminta module.`;
  }

  return `Jalankan ${hint.command} dari ${directory}.`;
}

function turkishNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Yayınlamadan önce yüksek riskli bağımlılıkları değiştirin veya incelemeye yükseltin.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Bu projeyi onaylamadan önce eksik lisans kanıtını toplayın.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Bu profille yayınlamadan önce işaretlenen bağımlılıkları inceleyin.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "--prod ile çalıştırın veya geliştirme amaçlı riski üretim dışında tutun.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Bu projeyi dağıtırken gerekli NOTICE veya atıf dosyalarını koruyun.";
  }

  return "Bu profil için eylem gerekmiyor.";
}

function turkishEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} / ${advice.unknownFindings} bilinmeyen`;
  const prefix = `Bilinmeyen bulguların çoğu eksik yerel paket kaynak/önbellek kanıtından kaynaklanıyor gibi görünüyor (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${turkishEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} Mümkün olduğunda tam uygulama derlemesi yerine önce bağımlılıkları geri yükleyin, sonra Ohrisk'i yeniden çalıştırın. Diğer ekosistem örnekleri: npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle dependency resolution, Python virtualenv install, dart pub get ve swift package resolve.`;
}

function turkishEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "tarama kökü" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? `${hint.sourceFileLabel} içeren dizin` : "bu dizin";
    return `${source} (${directory}) içinde ${hint.command} çalıştırın; go.work için Go toolchain modül isterse use içinde listelenen modül dizinini kullanın.`;
  }

  return `${directory} içinde ${hint.command} çalıştırın.`;
}

function russianNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Замените зависимости высокого риска или передайте их на проверку перед публикацией.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Соберите недостающие доказательства лицензий перед одобрением проекта.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Проверьте отмеченные зависимости перед публикацией с этим профилем.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Запустите с --prod или не допускайте dev-only риск в production.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Сохраняйте необходимые NOTICE или attribution файлы при распространении проекта.";
  }

  return "Для этого профиля действий не требуется.";
}

function russianEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} / ${advice.unknownFindings} неизвестных`;
  const prefix = `Многие неизвестные находки выглядят как следствие отсутствующих локальных исходников или кэша пакетов (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${russianEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} По возможности сначала восстановите зависимости без полной сборки приложения, затем повторно запустите Ohrisk. Примеры для других экосистем: npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle dependency resolution, Python virtualenv install, dart pub get и swift package resolve.`;
}

function russianEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "корень сканирования" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? `каталог с ${hint.sourceFileLabel}` : "этот каталог";
    return `Выполните ${hint.command} в ${source} (${directory}); для go.work используйте каталог модуля из use, если Go toolchain попросит модуль.`;
  }

  return `Выполните ${hint.command} в ${directory}.`;
}

function germanNextAction(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Ersetzen Sie Abhängigkeiten mit hohem Risiko oder eskalieren Sie sie vor der Veröffentlichung.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Sammeln Sie fehlende Lizenznachweise, bevor Sie dieses Projekt freigeben.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Prüfen Sie markierte Abhängigkeiten vor der Veröffentlichung mit diesem Profil.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Führen Sie den Scan mit --prod aus oder halten Sie Entwicklungsrisiken aus der Produktion heraus.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Bewahren Sie erforderliche NOTICE- oder Attribution-Dateien bei der Verteilung dieses Projekts auf.";
  }

  return "Für dieses Profil ist keine Aktion erforderlich.";
}

function germanEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} / ${advice.unknownFindings} unbekannt`;
  const prefix = `Viele unbekannte Befunde wirken durch fehlende lokale Paketquellen oder Cache-Nachweise verursacht (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${germanEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} Stellen Sie nach Möglichkeit zuerst nur die Abhängigkeiten wieder her, statt die ganze App zu bauen, und führen Sie Ohrisk danach erneut aus. Weitere Beispiele nach Ökosystem: npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle dependency resolution, Python virtualenv install, dart pub get und swift package resolve.`;
}

function germanEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "Scan-Root" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? `Verzeichnis mit ${hint.sourceFileLabel}` : "dieses Verzeichnis";
    return `Führen Sie ${hint.command} im ${source} (${directory}) aus; verwenden Sie bei go.work ein in use gelistetes Modulverzeichnis, falls die Go-Toolchain ein Modul verlangt.`;
  }

  return `Führen Sie ${hint.command} in ${directory} aus.`;
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

function spanishFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "El paquete local está marcado como private en package.json, así que la falta de metadatos públicos de licencia se trata como evidencia de paquete interno.";
    case `License expression is low risk for ${profile}.`:
      return `La expresión de licencia es de bajo riesgo para ${profile}.`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `La expresión de licencia debe revisarse antes de publicar bajo ${profile}.`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "Los metadatos del paquete marcan explícitamente el paquete como UNLICENSED.";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `La expresión de licencia incluye una restricción de código disponible o uso comercial para ${profile}.`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `La evidencia de licencia contiene una restricción explícita de uso comercial para ${profile}.`;
    case `License expression is high risk for ${profile}.`:
      return `La expresión de licencia es de alto riesgo para ${profile}.`;
    case "Package metadata does not declare a license expression.":
      return "Los metadatos del paquete no declaran una expresión de licencia.";
    case "Package metadata declares a malformed license expression.":
      return "Los metadatos del paquete declaran una expresión de licencia mal formada.";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk no reconoce la expresión de licencia.";
    default:
      return finding.reason;
  }
}

function frenchFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "Le paquet local est marqué private dans package.json; les métadonnées publiques de licence manquantes sont donc traitées comme évidence de paquet interne.";
    case `License expression is low risk for ${profile}.`:
      return `L'expression de licence présente un faible risque pour ${profile}.`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `L'expression de licence doit être revue avant une publication sous ${profile}.`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "Les métadonnées du paquet marquent explicitement le paquet comme UNLICENSED.";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `L'expression de licence inclut une restriction source-available ou d'usage commercial pour ${profile}.`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `L'évidence de licence contient une restriction explicite d'usage commercial pour ${profile}.`;
    case `License expression is high risk for ${profile}.`:
      return `L'expression de licence présente un risque élevé pour ${profile}.`;
    case "Package metadata does not declare a license expression.":
      return "Les métadonnées du paquet ne déclarent pas d'expression de licence.";
    case "Package metadata declares a malformed license expression.":
      return "Les métadonnées du paquet déclarent une expression de licence mal formée.";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk ne reconnaît pas l'expression de licence.";
    default:
      return finding.reason;
  }
}

function chineseFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "本地包在 package.json 中标记为 private，因此缺失的公开许可证元数据会被视为内部包证据。";
    case `License expression is low risk for ${profile}.`:
      return `许可证表达式对 ${profile} 来说是低风险。`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `在 ${profile} 下发布前应审查许可证表达式。`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "包元数据明确将此包标记为 UNLICENSED。";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `许可证表达式包含对 ${profile} 的 source-available 或商业使用限制。`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `许可证证据包含对 ${profile} 的明确商业使用限制。`;
    case `License expression is high risk for ${profile}.`:
      return `许可证表达式对 ${profile} 来说是高风险。`;
    case "Package metadata does not declare a license expression.":
      return "包元数据未声明许可证表达式。";
    case "Package metadata declares a malformed license expression.":
      return "包元数据声明了格式错误的许可证表达式。";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk 无法识别该许可证表达式。";
    default:
      return finding.reason;
  }
}

function hindiFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "स्थानीय पैकेज package.json में private है, इसलिए अनुपस्थित सार्वजनिक लाइसेंस metadata को internal package साक्ष्य माना गया है।";
    case `License expression is low risk for ${profile}.`:
      return `लाइसेंस expression ${profile} के लिए कम जोखिम है।`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `${profile} के तहत रिलीज़ से पहले लाइसेंस expression की समीक्षा करनी चाहिए।`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "पैकेज metadata इस पैकेज को स्पष्ट रूप से UNLICENSED बताता है।";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `लाइसेंस expression में ${profile} के लिए source-available या commercial-use restriction है।`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `लाइसेंस साक्ष्य में ${profile} के लिए स्पष्ट commercial-use restriction है।`;
    case `License expression is high risk for ${profile}.`:
      return `लाइसेंस expression ${profile} के लिए उच्च जोखिम है।`;
    case "Package metadata does not declare a license expression.":
      return "पैकेज metadata कोई लाइसेंस expression घोषित नहीं करता।";
    case "Package metadata declares a malformed license expression.":
      return "पैकेज metadata गलत प्रारूप वाला लाइसेंस expression घोषित करता है।";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk इस लाइसेंस expression को पहचान नहीं सका।";
    default:
      return finding.reason;
  }
}

function japaneseFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "ローカルパッケージが package.json で private と示されているため、不足している公開ライセンスメタデータは内部パッケージ根拠として扱われます。";
    case `License expression is low risk for ${profile}.`:
      return `ライセンス expression は ${profile} では低リスクです。`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `${profile} で出荷する前にライセンス expression をレビューする必要があります。`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "パッケージ metadata はこのパッケージを明示的に UNLICENSED と示しています。";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `ライセンス expression には ${profile} 向けの source-available または commercial-use restriction が含まれています。`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `ライセンス根拠には ${profile} 向けの明示的な commercial-use restriction が含まれています。`;
    case `License expression is high risk for ${profile}.`:
      return `ライセンス expression は ${profile} では高リスクです。`;
    case "Package metadata does not declare a license expression.":
      return "パッケージ metadata がライセンス expression を宣言していません。";
    case "Package metadata declares a malformed license expression.":
      return "パッケージ metadata が形式不正のライセンス expression を宣言しています。";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk はこのライセンス expression を認識できません。";
    default:
      return finding.reason;
  }
}

function indonesianFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "Paket lokal ditandai private di package.json, jadi metadata lisensi publik yang hilang diperlakukan sebagai bukti paket internal.";
    case `License expression is low risk for ${profile}.`:
      return `License expression berisiko rendah untuk ${profile}.`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `License expression perlu direview sebelum rilis dengan ${profile}.`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "Metadata paket secara eksplisit menandai paket ini sebagai UNLICENSED.";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `License expression mencakup pembatasan source-available atau commercial-use untuk ${profile}.`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `Bukti lisensi berisi pembatasan commercial-use eksplisit untuk ${profile}.`;
    case `License expression is high risk for ${profile}.`:
      return `License expression berisiko tinggi untuk ${profile}.`;
    case "Package metadata does not declare a license expression.":
      return "Metadata paket tidak mendeklarasikan license expression.";
    case "Package metadata declares a malformed license expression.":
      return "Metadata paket mendeklarasikan license expression yang salah format.";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk tidak mengenali license expression ini.";
    default:
      return finding.reason;
  }
}

function turkishFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "Yerel paket package.json içinde private olarak işaretli, bu yüzden eksik genel lisans metadata'sı dahili paket kanıtı olarak değerlendirildi.";
    case `License expression is low risk for ${profile}.`:
      return `Lisans ifadesi ${profile} için düşük riskli.`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `${profile} altında yayınlamadan önce lisans ifadesi incelenmeli.`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "Paket metadata'sı bu paketi açıkça UNLICENSED olarak işaretliyor.";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `Lisans ifadesi ${profile} için source-available veya commercial-use kısıtı içeriyor.`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `Lisans kanıtı ${profile} için açık bir commercial-use kısıtı içeriyor.`;
    case `License expression is high risk for ${profile}.`:
      return `Lisans ifadesi ${profile} için yüksek riskli.`;
    case "Package metadata does not declare a license expression.":
      return "Paket metadata'sı lisans ifadesi bildirmiyor.";
    case "Package metadata declares a malformed license expression.":
      return "Paket metadata'sı hatalı biçimli bir lisans ifadesi bildiriyor.";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk bu lisans ifadesini tanımıyor.";
    default:
      return finding.reason;
  }
}

function russianFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "Локальный пакет отмечен как private в package.json, поэтому отсутствующие публичные метаданные лицензии считаются доказательством внутреннего пакета.";
    case `License expression is low risk for ${profile}.`:
      return `Лицензионное выражение имеет низкий риск для ${profile}.`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `Лицензионное выражение нужно проверить перед публикацией с ${profile}.`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "Метаданные пакета явно отмечают пакет как UNLICENSED.";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `Лицензионное выражение содержит source-available или commercial-use ограничение для ${profile}.`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `Лицензионное доказательство содержит явное commercial-use ограничение для ${profile}.`;
    case `License expression is high risk for ${profile}.`:
      return `Лицензионное выражение имеет высокий риск для ${profile}.`;
    case "Package metadata does not declare a license expression.":
      return "Метаданные пакета не объявляют лицензионное выражение.";
    case "Package metadata declares a malformed license expression.":
      return "Метаданные пакета объявляют лицензионное выражение с неверным форматом.";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk не распознает это лицензионное выражение.";
    default:
      return finding.reason;
  }
}

function germanFindingReason(finding: RiskFinding, profile: string): string {
  switch (finding.reason) {
    case "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.":
      return "Das lokale Paket ist in package.json als private markiert, daher werden fehlende öffentliche Lizenzmetadaten als Nachweis für ein internes Paket behandelt.";
    case `License expression is low risk for ${profile}.`:
      return `Der Lizenzausdruck ist für ${profile} risikoarm.`;
    case `License expression should be reviewed before shipping under ${profile}.`:
      return `Der Lizenzausdruck sollte vor der Veröffentlichung unter ${profile} geprüft werden.`;
    case "Package metadata explicitly marks the package as UNLICENSED.":
      return "Die Paketmetadaten markieren dieses Paket ausdrücklich als UNLICENSED.";
    case `License expression includes a source-available or commercial-use restriction for ${profile}.`:
      return `Der Lizenzausdruck enthält eine Source-Available- oder Commercial-Use-Einschränkung für ${profile}.`;
    case `License evidence contains an explicit commercial-use restriction for ${profile}.`:
      return `Der Lizenznachweis enthält eine ausdrückliche Commercial-Use-Einschränkung für ${profile}.`;
    case `License expression is high risk for ${profile}.`:
      return `Der Lizenzausdruck ist für ${profile} hochriskant.`;
    case "Package metadata does not declare a license expression.":
      return "Die Paketmetadaten deklarieren keinen Lizenzausdruck.";
    case "Package metadata declares a malformed license expression.":
      return "Die Paketmetadaten deklarieren einen fehlerhaft formatierten Lizenzausdruck.";
    case "License expression is not recognized by Ohrisk.":
      return "Ohrisk erkennt diesen Lizenzausdruck nicht.";
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

function spanishFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "No se requiere acción para este perfil.";
    case "Replace this package or escalate before shipping.":
      return "Reemplaza este paquete o escálalo antes de publicar.";
    case "Do not ship this package until license permissions are clarified.":
      return "No publiques este paquete hasta aclarar los permisos de licencia.";
    case NOTICE_ACTION:
      return "Conserva los archivos NOTICE o de atribución requeridos al distribuir este paquete.";
    case "Review this package before shipping.":
      return "Revisa este paquete antes de publicar.";
    case "Keep this package out of production or scan with --prod.":
      return "Mantén este paquete fuera de producción o escanea con --prod.";
    case "Add or verify package license metadata before approving this package.":
      return "Agrega o verifica los metadatos de licencia del paquete antes de aprobarlo.";
    case "Fix or manually review the declared license expression before approving this package.":
      return "Corrige o revisa manualmente la expresión de licencia declarada antes de aprobar este paquete.";
    case "Collect license evidence before approving this package.":
      return "Recopila evidencia de licencia antes de aprobar este paquete.";
    default:
      return finding.action;
  }
}

function frenchFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "Aucune action requise pour ce profil.";
    case "Replace this package or escalate before shipping.":
      return "Remplacez ce paquet ou escaladez-le avant la publication.";
    case "Do not ship this package until license permissions are clarified.":
      return "Ne publiez pas ce paquet tant que les permissions de licence ne sont pas clarifiées.";
    case NOTICE_ACTION:
      return "Conservez les fichiers NOTICE ou d'attribution requis lors de la distribution de ce paquet.";
    case "Review this package before shipping.":
      return "Passez ce paquet en revue avant la publication.";
    case "Keep this package out of production or scan with --prod.":
      return "Gardez ce paquet hors production ou scannez avec --prod.";
    case "Add or verify package license metadata before approving this package.":
      return "Ajoutez ou vérifiez les métadonnées de licence du paquet avant de l'approuver.";
    case "Fix or manually review the declared license expression before approving this package.":
      return "Corrigez ou revoyez manuellement l'expression de licence déclarée avant d'approuver ce paquet.";
    case "Collect license evidence before approving this package.":
      return "Collectez l'évidence de licence avant d'approuver ce paquet.";
    default:
      return finding.action;
  }
}

function chineseFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "此配置档不需要进一步操作。";
    case "Replace this package or escalate before shipping.":
      return "发布前替换此包，或升级给负责人审查。";
    case "Do not ship this package until license permissions are clarified.":
      return "在许可证权限明确之前，不要发布此包。";
    case NOTICE_ACTION:
      return "分发此包时保留所需的 NOTICE 或署名文件。";
    case "Review this package before shipping.":
      return "发布前审查此包。";
    case "Keep this package out of production or scan with --prod.":
      return "让此包留在生产之外，或使用 --prod 重新扫描。";
    case "Add or verify package license metadata before approving this package.":
      return "批准此包之前，添加或验证包许可证元数据。";
    case "Fix or manually review the declared license expression before approving this package.":
      return "批准此包之前，修复或人工审查声明的许可证表达式。";
    case "Collect license evidence before approving this package.":
      return "批准此包之前，收集许可证证据。";
    default:
      return finding.action;
  }
}

function hindiFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "इस प्रोफ़ाइल के लिए कोई कार्रवाई आवश्यक नहीं।";
    case "Replace this package or escalate before shipping.":
      return "रिलीज़ से पहले इस पैकेज को बदलें या समीक्षा के लिए आगे बढ़ाएँ।";
    case "Do not ship this package until license permissions are clarified.":
      return "जब तक लाइसेंस अनुमतियाँ स्पष्ट न हों, इस पैकेज को रिलीज़ न करें।";
    case NOTICE_ACTION:
      return "इस पैकेज को वितरित करते समय आवश्यक NOTICE या attribution फ़ाइलें बनाए रखें।";
    case "Review this package before shipping.":
      return "रिलीज़ से पहले इस पैकेज की समीक्षा करें।";
    case "Keep this package out of production or scan with --prod.":
      return "इस पैकेज को उत्पादन से बाहर रखें या --prod के साथ स्कैन करें।";
    case "Add or verify package license metadata before approving this package.":
      return "इस पैकेज को मंज़ूर करने से पहले पैकेज लाइसेंस metadata जोड़ें या सत्यापित करें।";
    case "Fix or manually review the declared license expression before approving this package.":
      return "इस पैकेज को मंज़ूर करने से पहले घोषित लाइसेंस expression ठीक करें या मैनुअल समीक्षा करें।";
    case "Collect license evidence before approving this package.":
      return "इस पैकेज को मंज़ूर करने से पहले लाइसेंस साक्ष्य इकट्ठा करें।";
    default:
      return finding.action;
  }
}

function japaneseFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "このプロファイルでは対応は不要です。";
    case "Replace this package or escalate before shipping.":
      return "リリース前にこのパッケージを置き換えるか、レビューにエスカレーションしてください。";
    case "Do not ship this package until license permissions are clarified.":
      return "ライセンス権限が明確になるまで、このパッケージをリリースしないでください。";
    case NOTICE_ACTION:
      return "このパッケージを配布するときは、必要な NOTICE または attribution ファイルを保持してください。";
    case "Review this package before shipping.":
      return "リリース前にこのパッケージをレビューしてください。";
    case "Keep this package out of production or scan with --prod.":
      return "このパッケージを本番から外すか、--prod でスキャンしてください。";
    case "Add or verify package license metadata before approving this package.":
      return "このパッケージを承認する前に、パッケージライセンス metadata を追加または確認してください。";
    case "Fix or manually review the declared license expression before approving this package.":
      return "このパッケージを承認する前に、宣言されたライセンス expression を修正または手動レビューしてください。";
    case "Collect license evidence before approving this package.":
      return "このパッケージを承認する前に、ライセンス根拠を収集してください。";
    default:
      return finding.action;
  }
}

function indonesianFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "Tidak ada tindakan yang diperlukan untuk profil ini.";
    case "Replace this package or escalate before shipping.":
      return "Ganti paket ini atau eskalasikan untuk review sebelum rilis.";
    case "Do not ship this package until license permissions are clarified.":
      return "Jangan rilis paket ini sampai izin lisensinya jelas.";
    case NOTICE_ACTION:
      return "Pertahankan file NOTICE atau atribusi yang diperlukan saat mendistribusikan paket ini.";
    case "Review this package before shipping.":
      return "Review paket ini sebelum rilis.";
    case "Keep this package out of production or scan with --prod.":
      return "Jauhkan paket ini dari produksi atau pindai dengan --prod.";
    case "Add or verify package license metadata before approving this package.":
      return "Tambahkan atau verifikasi metadata lisensi paket sebelum menyetujui paket ini.";
    case "Fix or manually review the declared license expression before approving this package.":
      return "Perbaiki atau review manual license expression yang dideklarasikan sebelum menyetujui paket ini.";
    case "Collect license evidence before approving this package.":
      return "Kumpulkan bukti lisensi sebelum menyetujui paket ini.";
    default:
      return finding.action;
  }
}

function turkishFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "Bu profil için eylem gerekmiyor.";
    case "Replace this package or escalate before shipping.":
      return "Yayınlamadan önce bu paketi değiştirin veya incelemeye yükseltin.";
    case "Do not ship this package until license permissions are clarified.":
      return "Lisans izinleri netleşene kadar bu paketi yayınlamayın.";
    case NOTICE_ACTION:
      return "Bu paketi dağıtırken gerekli NOTICE veya atıf dosyalarını koruyun.";
    case "Review this package before shipping.":
      return "Yayınlamadan önce bu paketi inceleyin.";
    case "Keep this package out of production or scan with --prod.":
      return "Bu paketi üretim dışında tutun veya --prod ile tarayın.";
    case "Add or verify package license metadata before approving this package.":
      return "Bu paketi onaylamadan önce paket lisans metadata'sını ekleyin veya doğrulayın.";
    case "Fix or manually review the declared license expression before approving this package.":
      return "Bu paketi onaylamadan önce bildirilen lisans ifadesini düzeltin veya elle inceleyin.";
    case "Collect license evidence before approving this package.":
      return "Bu paketi onaylamadan önce lisans kanıtı toplayın.";
    default:
      return finding.action;
  }
}

function russianFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "Для этого профиля действий не требуется.";
    case "Replace this package or escalate before shipping.":
      return "Замените этот пакет или передайте его на проверку перед публикацией.";
    case "Do not ship this package until license permissions are clarified.":
      return "Не публикуйте этот пакет, пока лицензионные разрешения не будут уточнены.";
    case NOTICE_ACTION:
      return "Сохраняйте необходимые NOTICE или attribution файлы при распространении этого пакета.";
    case "Review this package before shipping.":
      return "Проверьте этот пакет перед публикацией.";
    case "Keep this package out of production or scan with --prod.":
      return "Не допускайте этот пакет в production или просканируйте с --prod.";
    case "Add or verify package license metadata before approving this package.":
      return "Добавьте или проверьте метаданные лицензии пакета перед его одобрением.";
    case "Fix or manually review the declared license expression before approving this package.":
      return "Исправьте или вручную проверьте объявленное лицензионное выражение перед одобрением пакета.";
    case "Collect license evidence before approving this package.":
      return "Соберите лицензионные доказательства перед одобрением пакета.";
    default:
      return finding.action;
  }
}

function germanFindingAction(finding: RiskFinding): string {
  switch (finding.action) {
    case "No action needed for this profile.":
      return "Für dieses Profil ist keine Aktion erforderlich.";
    case "Replace this package or escalate before shipping.":
      return "Ersetzen Sie dieses Paket oder eskalieren Sie es vor der Veröffentlichung.";
    case "Do not ship this package until license permissions are clarified.":
      return "Veröffentlichen Sie dieses Paket nicht, bis die Lizenzberechtigungen geklärt sind.";
    case NOTICE_ACTION:
      return "Bewahren Sie erforderliche NOTICE- oder Attribution-Dateien bei der Verteilung dieses Pakets auf.";
    case "Review this package before shipping.":
      return "Prüfen Sie dieses Paket vor der Veröffentlichung.";
    case "Keep this package out of production or scan with --prod.":
      return "Halten Sie dieses Paket aus der Produktion heraus oder scannen Sie mit --prod.";
    case "Add or verify package license metadata before approving this package.":
      return "Ergänzen oder prüfen Sie die Paket-Lizenzmetadaten, bevor Sie dieses Paket freigeben.";
    case "Fix or manually review the declared license expression before approving this package.":
      return "Korrigieren oder prüfen Sie den deklarierten Lizenzausdruck manuell, bevor Sie dieses Paket freigeben.";
    case "Collect license evidence before approving this package.":
      return "Sammeln Sie Lizenznachweise, bevor Sie dieses Paket freigeben.";
    default:
      return finding.action;
  }
}
