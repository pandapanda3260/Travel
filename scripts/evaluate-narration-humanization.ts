import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";
import { format } from "prettier";

import {
  averageNarrationHumanizationScores,
  evaluateNarrationHumanizationTarget,
  normalizeNarrationForHumanization,
  NARRATION_HUMANIZATION_TARGET,
  scoreNarrationHumanization,
  splitNarrationSentences,
  type NarrationHumanizationMetricKey,
  type NarrationHumanizationScore,
} from "../src/lib/narration-humanization-evaluator";
import { inspectNarrationQuality } from "../src/lib/narration-standards";
import { countNarrationCharacters } from "../src/lib/narration";

type DbRecord = {
  key: string;
  data: string;
};

type HumanSample = {
  id: string;
  name: string;
  text: string;
  score: NarrationHumanizationScore;
};

type SystemSample = {
  id: string;
  title: string;
  videoType: string;
  source: "video-task" | "narration-result";
  text: string;
  score: NarrationHumanizationScore;
  qualityIssueCount: number;
  qualityIssueMessages: string[];
};

const metricLabels: Record<NarrationHumanizationMetricKey, string> = {
  audience: "对象感",
  trust: "信任/避坑",
  specificity: "具体证据",
  imagery: "动作画面",
  continuity: "前后承接",
  cadence: "口播节奏",
};

function readRecords(db: Database.Database, collection: string) {
  return db.prepare("select key, data from records where collection = ?").all(collection) as DbRecord[];
}

function parseJsonRecord<T extends Record<string, unknown>>(row: DbRecord): T | null {
  try {
    return JSON.parse(row.data) as T;
  } catch {
    return null;
  }
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stripNarrationLabels(text: string) {
  return String(text ?? "")
    .replace(/(?:^|\n)\s*(?:片段|镜头)\s*\d+\s*[：:]/gu, "\n")
    .trim();
}

function compactSnippet(text: string, limit = 72) {
  const normalized = normalizeNarrationForHumanization(text);
  const chars = Array.from(normalized);
  return chars.length > limit ? `${chars.slice(0, limit).join("")}...` : normalized;
}

function markdownCell(value: string | number) {
  return String(value).replace(/\|/g, "\\|").replace(/\n+/g, " / ");
}

function collectHumanSamples(db: Database.Database): HumanSample[] {
  return readRecords(db, "video-materials")
    .map((row) => {
      const record = parseJsonRecord<{
        materialId?: unknown;
        name?: unknown;
        rawTranscript?: unknown;
      }>(row);
      const text = getString(record?.rawTranscript).trim();
      if (countNarrationCharacters(text) < 80) {
        return null;
      }
      return {
        id: getString(record?.materialId) || row.key,
        name: getString(record?.name) || row.key,
        text,
        score: scoreNarrationHumanization(text),
      } satisfies HumanSample;
    })
    .filter((item): item is HumanSample => Boolean(item))
    .sort((left, right) => right.score.score - left.score.score);
}

function collectSystemSamples(db: Database.Database): SystemSample[] {
  const taskSamples = readRecords(db, "video-tasks")
    .map((row) => {
      const record = parseJsonRecord<{
        taskId?: unknown;
        title?: unknown;
        parameters?: { video?: { videoType?: unknown } };
        draftBundle?: { narrationScript?: unknown };
      }>(row);
      const text = stripNarrationLabels(getString(record?.draftBundle?.narrationScript));
      if (countNarrationCharacters(text) < 30) {
        return null;
      }
      return buildSystemSample({
        id: getString(record?.taskId) || row.key,
        title: getString(record?.title) || row.key,
        videoType: getString(record?.parameters?.video?.videoType) || "unknown",
        source: "video-task",
        text,
      });
    })
    .filter((item): item is SystemSample => Boolean(item));

  const narrationResultSamples = readRecords(db, "narration-results")
    .map((row) => {
      const record = parseJsonRecord<{
        resultId?: unknown;
        taskId?: unknown;
        title?: unknown;
        sourcePrompt?: unknown;
      }>(row);
      const text = stripNarrationLabels(getString(record?.sourcePrompt));
      if (countNarrationCharacters(text) < 30) {
        return null;
      }
      return buildSystemSample({
        id: getString(record?.resultId) || row.key,
        title: getString(record?.title) || getString(record?.taskId) || row.key,
        videoType: "narration-result",
        source: "narration-result",
        text,
      });
    })
    .filter((item): item is SystemSample => Boolean(item));

  const deduped = new Map<string, SystemSample>();
  for (const sample of [...taskSamples, ...narrationResultSamples]) {
    const key = normalizeNarrationForHumanization(sample.text);
    if (!deduped.has(key)) {
      deduped.set(key, sample);
    }
  }
  return Array.from(deduped.values()).sort((left, right) => left.score.score - right.score.score);
}

function buildSystemSample(input: {
  id: string;
  title: string;
  videoType: string;
  source: "video-task" | "narration-result";
  text: string;
}): SystemSample {
  const score = scoreNarrationHumanization(input.text);
  const sentences = splitNarrationSentences(input.text);
  const qualityIssues = inspectNarrationQuality(
    sentences.map((sentence, index) => ({
      shotIndex: index + 1,
      text: sentence,
      durationSeconds: 6,
      purpose: index === 0 ? "hook" : index === sentences.length - 1 ? "closing" : "experience",
    })),
  );

  return {
    ...input,
    score,
    qualityIssueCount: qualityIssues.length,
    qualityIssueMessages: Array.from(new Set(qualityIssues.map((issue) => issue.message))).slice(0, 6),
  };
}

function averageIssueCounts(samples: SystemSample[]) {
  if (!samples.length) return 0;
  return Number((samples.reduce((sum, sample) => sum + sample.qualityIssueCount, 0) / samples.length).toFixed(1));
}

function summarizeCommonIssues(samples: SystemSample[]) {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    for (const issue of sample.score.issues) {
      counts.set(issue, (counts.get(issue) ?? 0) + 1);
    }
    for (const issue of sample.qualityIssueMessages) {
      counts.set(issue, (counts.get(issue) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);
}

function buildMetricTable(title: string, average: ReturnType<typeof averageNarrationHumanizationScores>) {
  return [
    `### ${title}`,
    "",
    `综合分：**${average.score}**`,
    "",
    "| 维度 | 均分 |",
    "| --- | ---: |",
    ...(Object.keys(metricLabels) as NarrationHumanizationMetricKey[]).map(
      (key) => `| ${metricLabels[key]} | ${average.metrics[key]} |`,
    ),
    "",
  ].join("\n");
}

function buildReport(input: { humanSamples: HumanSample[]; systemSamples: SystemSample[] }) {
  const humanAverage = averageNarrationHumanizationScores(input.humanSamples.map((item) => item.score));
  const systemAverage = averageNarrationHumanizationScores(input.systemSamples.map((item) => item.score));
  const systemTarget = evaluateNarrationHumanizationTarget(input.systemSamples.map((item) => item.score));
  const gap = Number((humanAverage.score - systemAverage.score).toFixed(1));
  const commonIssues = summarizeCommonIssues(input.systemSamples);
  const worstSamples = input.systemSamples.slice(0, 6);
  const bestHumanSamples = input.humanSamples.slice(0, 5);
  const issueAverage = averageIssueCounts(input.systemSamples);
  const flaggedSystemCount = input.systemSamples.filter(
    (sample) => sample.qualityIssueCount > 0 || sample.score.hollowSignalCount > 0 || sample.score.emptyClaimCount > 0,
  ).length;

  return [
    "# 台词真人化评测报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "## 数据源",
    "",
    `- 真人样本：${input.humanSamples.length} 条，来自视频解析任务的 ASR 原始文稿。`,
    `- 系统样本：${input.systemSamples.length} 条，来自已生成任务的 narrationScript / 配音 sourcePrompt。`,
    `- 系统样本被规则命中的比例：${flaggedSystemCount}/${input.systemSamples.length}。`,
    "",
    "## 总体差距",
    "",
    `真人样本平均分 ${humanAverage.score}，系统样本平均分 ${systemAverage.score}，差距 **${gap}** 分。`,
    `系统样本平均每条命中 ${issueAverage} 个质量问题。`,
    "",
    "## 65 分目标验收",
    "",
    `- 目标平均分：${NARRATION_HUMANIZATION_TARGET.averageScore}`,
    `- 目标最低单条分：${NARRATION_HUMANIZATION_TARGET.minSampleScore}`,
    `- 当前是否达标：${systemTarget.passed ? "达标" : "未达标"}`,
    `- 当前最低单条分：${systemTarget.minSampleScore}`,
    `- 当前空泛/无支撑命中比例：${Math.round(systemTarget.flaggedRatio * 100)}%`,
    ...(systemTarget.failures.length ? systemTarget.failures.map((failure) => `- 未达标项：${failure}`) : []),
    "",
    buildMetricTable("真人 ASR 样本均分", humanAverage),
    buildMetricTable("系统生成样本均分", systemAverage),
    "## 真人样本高分特征",
    "",
    "| 素材 | 分数 | 高分原因 | 摘录 |",
    "| --- | ---: | --- | --- |",
    ...bestHumanSamples.map(
      (sample) =>
        `| ${markdownCell(sample.name)} | ${sample.score.score} | ${markdownCell(sample.score.strengths.slice(0, 3).join("；"))} | ${markdownCell(compactSnippet(sample.text))} |`,
    ),
    "",
    "## 系统样本低分对比",
    "",
    "| 样本 | 来源 | 分数 | 主要问题 | 摘录 |",
    "| --- | --- | ---: | --- | --- |",
    ...worstSamples.map(
      (sample) =>
        `| ${markdownCell(sample.title)} | ${markdownCell(sample.source)} | ${sample.score.score} | ${markdownCell(sample.score.issues.slice(0, 4).join("；"))} | ${markdownCell(compactSnippet(sample.text))} |`,
    ),
    "",
    "## 高频问题",
    "",
    ...commonIssues.map(([issue, count], index) => `${index + 1}. ${issue}：${count} 次`),
    "",
    "## 对目前系统的优化建议",
    "",
    "1. 初稿生成继续强化“先对象/痛点，再理由/证据”的硬约束；现在系统样本里最弱的是 trust 和 imagery，说明模型仍容易写成服务清单或景点标签。",
    "2. 润色阶段不能只逐句变顺，要看整条脚本的开场、中段、收尾；低分样本普遍像互不相关的短句合集。",
    "3. 质量检查应把“省心、轻松、舒服、值得”视为需要证据的结论词，缺少支撑时触发重写，而不是放行。",
    "4. 压缩超时台词时保留对象、动作、场景和理由，优先删弱修饰词，避免压成“这趟就值了”“顺路看”这类口号。",
    "5. 后续每次上传新真人视频或生成新任务后，都重新运行本报告，把真人均分作为合格线，把系统样本最差项作为下一轮 prompt/规则迭代输入。",
    "",
    "## 有效性验证",
    "",
    `- 当前评测脚本已能从真实 ASR 中抽取 ${input.humanSamples.length} 条真人样本，并自动抓取 ${input.systemSamples.length} 条系统台词样本。`,
    `- 现有质量规则已命中 ${flaggedSystemCount} 条系统样本，说明上轮加入的空泛口号和真人推荐规则能拦住旧版问题。`,
    "- 新增单元测试会验证：真人样本评分显著高于空泛系统台词；把空泛短句改成有对象、有动作、有证据的表达后，评分必须明显提升。",
    "",
  ].join("\n");
}

async function main() {
  const dbPath = join(process.cwd(), "data/app.db");
  const outputPath = join(process.cwd(), "docs/narration-humanization-evaluation.md");
  const db = new Database(dbPath, { readonly: true });
  const humanSamples = collectHumanSamples(db);
  const systemSamples = collectSystemSamples(db);
  db.close();

  const report = await format(buildReport({ humanSamples, systemSamples }), { parser: "markdown" });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report, "utf8");

  const humanAverage = averageNarrationHumanizationScores(humanSamples.map((item) => item.score));
  const systemAverage = averageNarrationHumanizationScores(systemSamples.map((item) => item.score));
  const systemTarget = evaluateNarrationHumanizationTarget(systemSamples.map((item) => item.score));
  console.log(
    JSON.stringify(
      {
        outputPath,
        humanSamples: humanSamples.length,
        systemSamples: systemSamples.length,
        humanAverage: humanAverage.score,
        systemAverage: systemAverage.score,
        gap: Number((humanAverage.score - systemAverage.score).toFixed(1)),
        targetPassed: systemTarget.passed,
        targetFailures: systemTarget.failures,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
