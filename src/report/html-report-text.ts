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

const HTML_REPORT_TEXT: Record<ReportLanguage, HtmlReportText> = {
  en: ENGLISH_TEXT,
  ko: KOREAN_TEXT,
  es: SPANISH_TEXT,
  fr: FRENCH_TEXT
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
