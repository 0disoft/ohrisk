import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const TURKISH_TEXT: HtmlReportText = {
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
