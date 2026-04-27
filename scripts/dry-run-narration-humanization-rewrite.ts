import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";
import { format } from "prettier";

import {
  evaluateNarrationHumanizationTarget,
  NARRATION_HUMANIZATION_TARGET,
  scoreNarrationHumanization,
  shouldRewriteNarrationForHumanization,
} from "../src/lib/narration-humanization-evaluator";
import { buildNarrationHumanizationRewriteSystemPrompt } from "../src/lib/narration-prompt-library";
import { callTaskGenerationLlm, getTaskGenerationRuntime } from "../src/lib/task-generation-runtime";
import { stripCodeFence } from "../src/lib/narration";
import type { VideoTaskVideoType } from "../src/lib/video-task-schema";

type DbRecord = {
  key: string;
  data: string;
};

type RewriteSample = {
  id: string;
  title: string;
  videoType: VideoTaskVideoType;
  source: "video-task" | "narration-result";
  rawScript: string;
};

type RewriteResult = RewriteSample & {
  beforeScore: number;
  afterScore: number;
  improvement: number;
  rounds: number;
  afterMetrics: ReturnType<typeof scoreNarrationHumanization>["metrics"];
  targetPassed: boolean;
  targetFailures: string[];
  beforeIssues: string[];
  afterIssues: string[];
  rewrittenScript: string;
};

const fallbackVideoType = "agency_guide_voiceover" satisfies VideoTaskVideoType;
const maxRewriteRounds = 2;
const minAcceptImprovement = 6;

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

function parseLabeledLines(script: string) {
  const lines = String(script ?? "")
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = lines
    .map((line, index) => {
      const match = /^(片段|镜头)\s*(\d+)\s*[：:]\s*(.*)$/u.exec(line);
      return {
        shotIndex: match ? Number(match[2]) || index + 1 : index + 1,
        displayLabel: match?.[1] ?? "片段",
        displayIndex: match ? Number(match[2]) || index + 1 : index + 1,
        currentText: (match?.[3] ?? line).trim(),
      };
    })
    .filter((line) => line.currentText);

  if (parsed.length > 0) {
    return parsed;
  }

  return String(script ?? "")
    .split(/[。！？；!?;]+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      shotIndex: index + 1,
      displayLabel: "片段",
      displayIndex: index + 1,
      currentText: line,
    }));
}

function rebuildScript(lines: Array<{ displayLabel: string; displayIndex: number; currentText: string }>) {
  return lines.map((line) => `${line.displayLabel}${line.displayIndex}：${line.currentText}`).join("\n");
}

function collectSamples(db: Database.Database) {
  const taskRows = readRecords(db, "video-tasks");
  const taskVideoTypeMap = new Map<string, VideoTaskVideoType>();
  const taskSamples = taskRows
    .map((row): RewriteSample | null => {
      const record = parseJsonRecord<{
        taskId?: unknown;
        title?: unknown;
        parameters?: { video?: { videoType?: unknown } };
        draftBundle?: { narrationScript?: unknown };
      }>(row);
      const taskId = getString(record?.taskId) || row.key;
      const videoType = (getString(record?.parameters?.video?.videoType) || fallbackVideoType) as VideoTaskVideoType;
      taskVideoTypeMap.set(taskId, videoType);
      const rawScript = getString(record?.draftBundle?.narrationScript).trim();
      if (!rawScript) return null;
      return {
        id: taskId,
        title: getString(record?.title) || row.key,
        videoType,
        source: "video-task" as const,
        rawScript,
      } satisfies RewriteSample;
    })
    .filter((item): item is RewriteSample => item !== null);

  const resultSamples = readRecords(db, "narration-results")
    .map((row): RewriteSample | null => {
      const record = parseJsonRecord<{
        resultId?: unknown;
        taskId?: unknown;
        title?: unknown;
        sourcePrompt?: unknown;
      }>(row);
      const rawScript = getString(record?.sourcePrompt).trim();
      if (!rawScript) return null;
      const taskId = getString(record?.taskId);
      return {
        id: getString(record?.resultId) || row.key,
        title: getString(record?.title) || taskId || row.key,
        videoType: taskVideoTypeMap.get(taskId) ?? fallbackVideoType,
        source: "narration-result" as const,
        rawScript,
      } satisfies RewriteSample;
    })
    .filter((item): item is RewriteSample => item !== null);

  const deduped = new Map<string, RewriteSample>();
  for (const sample of [...taskSamples, ...resultSamples]) {
    const key = sample.rawScript.replace(/\s+/g, "");
    if (!deduped.has(key)) deduped.set(key, sample);
  }
  return Array.from(deduped.values()).filter((sample) =>
    shouldRewriteNarrationForHumanization(scoreNarrationHumanization(sample.rawScript)),
  );
}

async function rewriteSample(sample: RewriteSample): Promise<RewriteResult> {
  const before = scoreNarrationHumanization(sample.rawScript);
  let currentScript = sample.rawScript;
  let currentScore = before;
  let rounds = 0;

  for (let attempt = 0; attempt < maxRewriteRounds; attempt += 1) {
    const lines = parseLabeledLines(currentScript);
    const targetResult = evaluateNarrationHumanizationTarget([currentScore]);
    const userContent = JSON.stringify(
      {
        dryRun: true,
        target: NARRATION_HUMANIZATION_TARGET,
        currentEvaluation: {
          ...currentScore,
          targetResult,
        },
        sourceContext: {
          title: sample.title,
          videoType: sample.videoType,
          source: sample.source,
        },
        fullCurrentScript: lines.map((line) => ({
          shotIndex: line.shotIndex,
          displayLabel: line.displayLabel,
          displayIndex: line.displayIndex,
          text: line.currentText,
        })),
        lines: lines.map((line, index) => ({
          ...line,
          durationSeconds: 6,
          suggestedCharacters: 20,
          maxCharacters: 38,
          purpose: index === 0 ? "hook" : index === lines.length - 1 ? "closing" : "experience",
          requiredImprovement:
            index === 0
              ? "开场补足对象、痛点、判断或反差"
              : index === lines.length - 1
                ? "收尾补足具体价值和行动感"
                : "中段补足动作画面、体验理由和前后承接",
        })),
      },
      null,
      2,
    );
    const response = await callTaskGenerationLlm({
      systemPrompt: buildNarrationHumanizationRewriteSystemPrompt(sample.videoType),
      userContent,
      temperature: 0.48,
      maxCompletionTokens: 2600,
    });
    if (!response) {
      throw new Error(`rewrite failed: ${sample.title}`);
    }
    const parsed = JSON.parse(stripCodeFence(response)) as Array<{ shotIndex?: number; text?: string }>;
    if (!Array.isArray(parsed)) {
      throw new Error(`rewrite returned non-array: ${sample.title}`);
    }
    const rewriteMap = new Map(
      parsed
        .filter((item) => item.shotIndex && item.text?.trim())
        .map((item) => [item.shotIndex!, item.text!.trim().replace(/[。！？；,.!?;]+$/u, "")]),
    );
    const rewrittenLines = lines.map((line) => ({
      ...line,
      currentText: rewriteMap.get(line.shotIndex) ?? line.currentText,
    }));
    const nextScript = rebuildScript(rewrittenLines);
    const nextScore = scoreNarrationHumanization(nextScript);
    const nextTargetPassed = evaluateNarrationHumanizationTarget([nextScore]).passed;
    const improvedEnough =
      nextScore.score >= currentScore.score + minAcceptImprovement ||
      (nextScore.score > currentScore.score &&
        (nextScore.metrics.trust > currentScore.metrics.trust ||
          nextScore.metrics.imagery > currentScore.metrics.imagery ||
          nextScore.metrics.continuity > currentScore.metrics.continuity));

    if (!nextTargetPassed && !improvedEnough) {
      break;
    }

    currentScript = nextScript;
    currentScore = nextScore;
    rounds += 1;
    if (nextTargetPassed) {
      break;
    }
  }
  const after = currentScore;
  const targetResult = evaluateNarrationHumanizationTarget([after]);

  return {
    ...sample,
    beforeScore: before.score,
    afterScore: after.score,
    improvement: after.score - before.score,
    rounds,
    afterMetrics: after.metrics,
    targetPassed: targetResult.passed,
    targetFailures: targetResult.failures,
    beforeIssues: before.issues,
    afterIssues: after.issues,
    rewrittenScript: currentScript,
  };
}

function compact(value: string, limit = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  return chars.length > limit ? `${chars.slice(0, limit).join("")}...` : normalized;
}

async function main() {
  const runtime = getTaskGenerationRuntime();
  if (!runtime.liveEnabled) {
    throw new Error(`文本模型未启用，无法执行 dry-run 重写：${runtime.configFileName}`);
  }

  const db = new Database(join(process.cwd(), "data/app.db"), { readonly: true });
  const samples = collectSamples(db);
  db.close();

  const results: RewriteResult[] = [];
  for (const sample of samples) {
    results.push(await rewriteSample(sample));
  }

  const averageBefore = results.length
    ? Number((results.reduce((sum, item) => sum + item.beforeScore, 0) / results.length).toFixed(1))
    : 0;
  const averageAfter = results.length
    ? Number((results.reduce((sum, item) => sum + item.afterScore, 0) / results.length).toFixed(1))
    : 0;
  const passedCount = results.filter((item) => item.afterScore >= 65).length;
  const targetPassedCount = results.filter((item) => item.targetPassed).length;
  const report = [
    "# 台词真人化重写 Dry Run",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    `- 样本数：${results.length}`,
    `- 改写前平均分：${averageBefore}`,
    `- 改写后平均分：${averageAfter}`,
    `- 平均提升：${Number((averageAfter - averageBefore).toFixed(1))}`,
    `- 达到 65 分样本：${passedCount}/${results.length}`,
    `- 单条完整达标样本：${targetPassedCount}/${results.length}`,
    `- 本轮是否达到 65 分优化目标：${averageAfter >= NARRATION_HUMANIZATION_TARGET.averageScore && passedCount === results.length ? "已达到" : "未达到"}`,
    "",
    "| 样本 | 来源 | 轮数 | 改写前 | 改写后 | 提升 | audience | trust | imagery | continuity | 改写后问题 | 改写摘录 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...results.map(
      (item) =>
        `| ${item.title.replace(/\|/g, "\\|")} | ${item.source} | ${item.rounds} | ${item.beforeScore} | ${item.afterScore} | ${item.improvement} | ${item.afterMetrics.audience} | ${item.afterMetrics.trust} | ${item.afterMetrics.imagery} | ${item.afterMetrics.continuity} | ${item.afterIssues.slice(0, 3).join("；").replace(/\|/g, "\\|")} | ${compact(item.rewrittenScript).replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## 全量改写对比",
    "",
    ...results.flatMap((item) => [
      `### ${item.title}`,
      "",
      `- 来源：${item.source}`,
      `- 分数：${item.beforeScore} -> ${item.afterScore}（+${item.improvement}）`,
      "",
      "改写前：",
      "",
      "```text",
      item.rawScript,
      "```",
      "",
      "改写后：",
      "",
      "```text",
      item.rewrittenScript,
      "```",
      "",
    ]),
    "",
    "## 未达标原因",
    "",
    ...(results.some((item) => !item.targetPassed)
      ? results
          .filter((item) => !item.targetPassed)
          .flatMap((item) => [
            `### ${item.title}`,
            "",
            ...item.targetFailures.map((failure) => `- ${failure}`),
            "",
            "```text",
            item.rewrittenScript,
            "```",
            "",
          ])
      : ["暂无，本轮所有样本均达到单条目标。", ""]),
    "## 对目前系统的优化建议",
    "",
    "1. 保留正式生成链路里的低分重写闸门：先评分，低于目标再整条重写，避免把所有台词都不必要地二次生成。",
    "2. 初稿和润色提示继续使用同一套真人推荐标准，重点压住三类问题：对象缺失、只列服务/景点、用“省心/舒服/值得”但不给证据。",
    "3. 超时压缩不能只砍字数，必须保留对象、判断、动作和具体证据；如果压缩后分数掉回 65 以下，应再次进入真人化重写。",
    "4. 后续新增真人 ASR 样本后继续重跑本脚本，用真人均分和系统均分的差距作为下一轮优化依据。",
    "",
  ].join("\n");

  const outputPath = join(process.cwd(), "docs/narration-humanization-rewrite-dry-run.md");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, await format(report, { parser: "markdown" }), "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        samples: results.length,
        averageBefore,
        averageAfter,
        averageImprovement: Number((averageAfter - averageBefore).toFixed(1)),
        passedCount,
        targetPassedCount,
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
