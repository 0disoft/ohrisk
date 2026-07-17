import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const SPANISH_TEXT: HtmlReportText = {
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
    scanCoverage: "Cobertura del análisis",
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
    skippedSubmodules: (count, paths, pathsTruncated) =>
      `Se omitieron ${count} submódulos de Git (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); la cobertura está incompleta.`,
    skippedSubmoduleAction:
      "Analice por separado los submódulos de Git omitidos antes de considerar completo este informe.",
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
