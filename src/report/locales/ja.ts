import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const JAPANESE_TEXT: HtmlReportText = {
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
