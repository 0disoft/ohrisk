import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const CHINESE_TEXT: HtmlReportText = {
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
    scanCoverage: "扫描范围",
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
    skippedSubmodules: (count, paths, pathsTruncated) =>
      `已跳过 ${count} 个 Git 子模块（${paths.join("、")}${pathsTruncated ? "、…" : ""}）；扫描范围不完整。`,
    skippedSubmoduleAction:
      "在将此报告视为完整报告之前，请单独扫描被跳过的 Git 子模块。",
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
