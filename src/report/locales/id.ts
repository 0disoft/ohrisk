import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const INDONESIAN_TEXT: HtmlReportText = {
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
