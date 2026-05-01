import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function readSource(pathname: string) {
  return readFileSync(join(repoRoot, pathname), "utf8");
}

test("视频生成提交与刷新链路统一依赖 commercial-billing-gateway", () => {
  const videoProviderSource = readSource("src/lib/video-provider.ts");
  const videoJobRunnerSource = readSource("src/lib/video-job-runner.ts");

  assert.equal(videoProviderSource.includes("./commercial-usage-charge"), false);
  assert.equal(videoJobRunnerSource.includes("./commercial-usage-charge"), false);
  assert.equal(videoProviderSource.includes("./commercial-billing-gateway"), true);
  assert.equal(videoJobRunnerSource.includes("./commercial-billing-gateway"), true);
});
