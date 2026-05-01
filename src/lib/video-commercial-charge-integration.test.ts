import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-video-commercial-charge-"));

Object.assign(process.env, {
  NODE_ENV: "test",
  TRAVEL_DATA_DIR: testDataDir,
  ARK_API_KEY: "",
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
});

let modulesPromise: Promise<{
  commercialCreditLedger: typeof import("./commercial-credit-ledger");
  videoJobRunner: typeof import("./video-job-runner");
  videoJobStore: typeof import("./video-job-store");
}> | null = null;

function loadModules() {
  modulesPromise ??= Promise.all([
    import("./commercial-credit-ledger"),
    import("./video-job-runner"),
    import("./video-job-store"),
  ]).then(([commercialCreditLedger, videoJobRunner, videoJobStore]) => ({
    commercialCreditLedger,
    videoJobRunner,
    videoJobStore,
  }));
  return modulesPromise;
}

test("视频任务记录会持久化商业积分冻结信息", async () => {
  const { videoJobRunner, videoJobStore } = await loadModules();
  const job = videoJobRunner.createVideoJobRecord({
    jobId: "job-commercial-charge",
    sourceTaskId: "task-commercial-charge",
    taskName: "商业扣费测试",
    originalPrompt: "测试",
    optimizedPrompt: "测试",
    strategy: {
      angle: "片段 1",
      hook: "测试",
      style: "Seedance 片段生成",
    },
    submittedAt: "2026-04-30T00:00:00.000Z",
    status: "QUEUED",
    mode: "live",
    logs: ["已提交"],
    provider: "seedance",
    modelId: "seedance-2",
    generationSettings: null,
    commercialChargeFreezeId: "freeze-001",
    commercialChargeStatus: "frozen",
  });

  videoJobStore.upsertVideoJob(job);
  const saved = videoJobStore.getVideoJob(job.jobId);

  assert.equal(saved?.commercialChargeFreezeId, "freeze-001");
  assert.equal(saved?.commercialChargeStatus, "frozen");
});

test("视频任务刷新失败时会释放商业积分冻结", async () => {
  const { commercialCreditLedger, videoJobRunner, videoJobStore } = await loadModules();
  const userId = "user-video-failed-release";
  const jobId = "job-video-failed-release";

  commercialCreditLedger.grantCredits({
    userId,
    credits: 2400,
    sourceType: "credit_package_grant",
    sourceBizId: "package-release-test",
    idempotencyKey: "grant-video-failed-release",
  });
  const { freeze } = commercialCreditLedger.freezeCredits({
    userId,
    credits: 2400,
    sourceType: "usage_charge",
    sourceBizId: jobId,
    idempotencyKey: "freeze-video-failed-release",
    taskId: "task-video-failed-release",
    featureCode: "video_15s_generation",
  });

  videoJobStore.upsertVideoJob(
    videoJobRunner.createVideoJobRecord({
      jobId,
      sourceTaskId: "task-video-failed-release",
      taskName: "失败释放测试",
      originalPrompt: "测试",
      optimizedPrompt: "测试",
      strategy: {
        angle: "片段 1",
        hook: "测试",
        style: "Seedance 片段生成",
      },
      submittedAt: "2026-04-30T00:00:00.000Z",
      status: "QUEUED",
      mode: "live",
      logs: ["已提交"],
      provider: "seedance",
      modelId: "seedance-2",
      generationSettings: null,
      commercialChargeFreezeId: freeze.freezeId,
      commercialChargeStatus: "frozen",
    }),
  );

  const refreshed = await videoJobRunner.refreshLiveJob(jobId);
  const releasedFreeze = commercialCreditLedger.getCommercialCreditFreezeById(freeze.freezeId);
  const balance = commercialCreditLedger.getCommercialCreditBalance(userId);

  assert.equal(refreshed?.status, "FAILED");
  assert.equal(refreshed?.commercialChargeStatus, "released");
  assert.equal(releasedFreeze?.status, "released");
  assert.equal(balance.availableCredits, 2400);
  assert.equal(balance.frozenCredits, 0);
});
