import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const RUSSIAN_TEXT: HtmlReportText = {
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
    scanCoverage: "Охват сканирования",
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
    skippedSubmodules: (count, paths, pathsTruncated) =>
      `Пропущено подмодулей Git: ${count} (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); охват неполный.`,
    skippedSymbolicLinks: (count, paths, pathsTruncated) =>
      `Пропущено символических ссылок без перехода к целям: ${count} (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); охват неполный.`,
    skippedNonPortablePaths: (count, paths, pathsTruncated) =>
      `Пропущено непереносимых путей: ${count} (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); охват неполный.`,
    incompleteRepositoryCoverageAction:
      "Проверьте пропущенные элементы репозитория и отдельно просканируйте исключенные входные данные зависимостей, прежде чем считать этот отчет полным.",
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
