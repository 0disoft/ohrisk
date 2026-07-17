import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const HINDI_TEXT: HtmlReportText = {
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
    scanCoverage: "स्कैन कवरेज",
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
    skippedSubmodules: (count, paths, pathsTruncated) =>
      `${count} Git सबमॉड्यूल छोड़े गए (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); स्कैन कवरेज अधूरा है।`,
    skippedSubmoduleAction:
      "इस रिपोर्ट को पूर्ण मानने से पहले छोड़े गए Git सबमॉड्यूल को अलग से स्कैन करें।",
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
