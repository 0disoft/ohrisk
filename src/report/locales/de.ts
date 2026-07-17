import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const GERMAN_TEXT: HtmlReportText = {
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
    scanCoverage: "Prüfabdeckung",
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
    skippedSubmodules: (count, paths, pathsTruncated) =>
      `${count} Git-Submodule übersprungen (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); die Abdeckung ist unvollständig.`,
    skippedSubmoduleAction:
      "Prüfen Sie die übersprungenen Git-Submodule separat, bevor Sie diesen Bericht als vollständig betrachten.",
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
