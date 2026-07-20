import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const FRENCH_TEXT: HtmlReportText = {
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
    scanCoverage: "Couverture de l’analyse",
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
    skippedSubmodules: (count, paths, pathsTruncated) =>
      `${count} sous-modules Git ignorés (${paths.join(", ")}${pathsTruncated ? ", …" : ""}) ; la couverture est incomplète.`,
    skippedSymbolicLinks: (count, paths, pathsTruncated) =>
      `${count} liens symboliques ignorés sans suivre leur cible (${paths.join(", ")}${pathsTruncated ? ", …" : ""}) ; la couverture est incomplète.`,
    skippedNonPortablePaths: (count, paths, pathsTruncated) =>
      `${count} chemins non portables ignorés (${paths.join(", ")}${pathsTruncated ? ", …" : ""}) ; la couverture est incomplète.`,
    incompleteRepositoryCoverageAction:
      "Examinez les entrées de dépôt ignorées et analysez séparément les entrées de dépendances omises avant de considérer ce rapport comme complet.",
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
