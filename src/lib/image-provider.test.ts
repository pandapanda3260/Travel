import test from "node:test";
import assert from "node:assert/strict";

import {
  applyImagePromptHardRequirements,
  generateSeedreamImages,
  SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE,
} from "./image-provider";
import {
  getImageCleaningRuntime,
  getImageGenerationRuntime,
  getVideoPipelineImageGenerationRuntime,
} from "./image-provider-config";

const IMAGE_MODEL_ENV_KEYS = [
  "TRAVEL_SHARED_ENV_FILE",
  "LIANGXIN_IMAGE_PROVIDER",
  "LIANGXIN_IMAGE_API_KEY",
  "LIANGXIN_IMAGE_BASE_URL",
  "LIANGXIN_IMAGE_MODEL",
  "VOLCENGINE_IMAGE_MODEL",
  "VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL",
  "VOLCENGINE_IMAGE_CLEAN_MODEL",
] as const;

function withImageModelEnv(overrides: Partial<Record<(typeof IMAGE_MODEL_ENV_KEYS)[number], string>>, run: () => void) {
  const snapshot = Object.fromEntries(IMAGE_MODEL_ENV_KEYS.map((key) => [key, process.env[key]]));

  try {
    for (const key of IMAGE_MODEL_ENV_KEYS) {
      delete process.env[key];
    }
    process.env.TRAVEL_SHARED_ENV_FILE = "/tmp/travel-image-provider-config-test.env";
    for (const [key, value] of Object.entries(overrides)) {
      process.env[key] = value;
    }
    run();
  } finally {
    for (const key of IMAGE_MODEL_ENV_KEYS) {
      const value = snapshot[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("送图模型前会统一补竖版构图和无文字硬约束", () => {
  const prompt = applyImagePromptHardRequirements("海边酒店夜景，大堂暖光，真实摄影风格", "1600x2848");

  assert.match(prompt, /竖构图9:16|portrait orientation/u);
  assert.match(prompt, /天然竖向拍摄和竖向观看/u);
  assert.match(prompt, /不要横图内容塞进竖版画布|不要把横版照片旋转90度/u);
  assert.match(prompt, /no text, no letters, no words, no numbers, no watermark/u);
});

test("已带基础约束的提示词不会重复堆叠同一条硬约束", () => {
  const prompt = applyImagePromptHardRequirements(
    "海边酒店夜景，竖构图9:16，no text, no letters, no words, no numbers, no watermark, no logo, no signage text, no caption, no subtitle, no collage, no split screen, single continuous image",
    "1600x2848",
  );

  const noTextMatches = prompt.match(/no text, no letters, no words, no numbers, no watermark/gu) ?? [];
  const orientationMatches = prompt.match(/竖构图9:16/gu) ?? [];

  assert.equal(noTextMatches.length, 1);
  assert.equal(orientationMatches.length, 1);
});

test("安全拦截降敏重试失败文案提示用户手动上传且不透出供应商原始错误", () => {
  assert.equal(
    SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE,
    "图片生成触发安全拦截，系统已自动降敏重试仍失败，请手动上传图片",
  );
  assert.doesNotMatch(SENSITIVE_IMAGE_PROMPT_RETRY_FAILED_MESSAGE, /request id|sensitive information/i);
});

test("图片生成运行时默认使用 seedream 4.5", () => {
  withImageModelEnv({}, () => {
    const runtime = getImageGenerationRuntime();

    assert.equal(runtime.modelId, "doubao-seedream-4-5-251128");
    assert.equal(runtime.providerLabel, "Doubao-Seedream-4.5");
  });
});

test("图片生成运行时默认回落到 seedream 4.5 且尊重显式模型覆盖", () => {
  withImageModelEnv({}, () => {
    const expectedModelId = "doubao-seedream-4-5-251128";

    assert.equal(getImageGenerationRuntime().modelId, expectedModelId);
    assert.equal(getVideoPipelineImageGenerationRuntime().modelId, expectedModelId);
    assert.equal(getImageCleaningRuntime().modelId, expectedModelId);
    assert.equal(getImageCleaningRuntime().providerLabel, "Doubao-Seedream-4.5（清洗）");
  });

  withImageModelEnv(
    {
      VOLCENGINE_IMAGE_MODEL: "doubao-seedream-4-5-251128",
      VOLCENGINE_VIDEO_PIPELINE_IMAGE_MODEL: "custom-video-pipeline-image-model",
      VOLCENGINE_IMAGE_CLEAN_MODEL: "custom-seedream-image-clean-model",
    },
    () => {
      assert.equal(getImageGenerationRuntime().modelId, "doubao-seedream-4-5-251128");
      assert.equal(getVideoPipelineImageGenerationRuntime().modelId, "custom-video-pipeline-image-model");
      assert.equal(getImageCleaningRuntime().modelId, "custom-seedream-image-clean-model");
      assert.equal(
        getImageCleaningRuntime().providerLabel,
        "Doubao-Seedream · custom-seedream-image-clean-model（清洗）",
      );
    },
  );
});

test("良心中转站配置会启用 image2 运行时并补全 HTTPS base url", () => {
  withImageModelEnv(
    {
      LIANGXIN_IMAGE_PROVIDER: "liangxin",
      LIANGXIN_IMAGE_API_KEY: "test-liangxin-key",
      LIANGXIN_IMAGE_BASE_URL: "gateway.example.com",
      LIANGXIN_IMAGE_MODEL: "gpt-image-2",
    },
    () => {
      const runtime = getImageGenerationRuntime();

      assert.equal(runtime.provider, "liangxin");
      assert.equal(runtime.modelId, "gpt-image-2");
      assert.equal(runtime.apiBase, "https://gateway.example.com");
      assert.equal(runtime.providerLabel, "良心中转站 · gpt-image-2");
      assert.equal(runtime.liveEnabled, true);
      assert.equal(runtime.hasApiKey, true);
    },
  );
});

test("良心中转站 image2 adapter 使用 OpenAI 图片请求形态且不夹带 Seedream 专属字段", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const previousStrictMode = process.env.USAGE_BILLING_STRICT_MODE;
  const previousRequirePricing = process.env.USAGE_BILLING_REQUIRE_PRICING;
  process.env.USAGE_BILLING_STRICT_MODE = "false";
  process.env.USAGE_BILLING_REQUIRE_PRICING = "false";
  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        data: [
          { b64_json: Buffer.from("image-1").toString("base64") },
          { url: "https://cdn.example.com/image-2.png" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const results = await generateSeedreamImages({
      prompt: "海边酒店夜景",
      size: "1024x1024",
      guidanceScale: 7.5,
      watermark: false,
      seed: null,
      outputCount: 2,
      runtimeOverride: {
        provider: "liangxin",
        liveEnabled: true,
        hasApiKey: true,
        apiBase: "https://gateway.example.com",
        apiKey: "test-liangxin-key",
        modelId: "gpt-image-2",
        providerLabel: "良心中转站 · gpt-image-2",
        configFileName: "test",
      },
    });

    assert.equal(results.length, 2);
    assert.equal(results[0]?.b64Json, Buffer.from("image-1").toString("base64"));
    assert.equal(results[1]?.url, "https://cdn.example.com/image-2.png");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://gateway.example.com/v1/images/generations");
    assert.equal(calls[0]?.body.model, "gpt-image-2");
    assert.equal(calls[0]?.body.n, 2);
    assert.equal(calls[0]?.body.size, "1024x1024");
    assert.equal("negative_prompt" in calls[0]!.body, false);
    assert.equal("watermark" in calls[0]!.body, false);
    assert.equal("optimize_prompt_options" in calls[0]!.body, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousStrictMode === undefined) {
      delete process.env.USAGE_BILLING_STRICT_MODE;
    } else {
      process.env.USAGE_BILLING_STRICT_MODE = previousStrictMode;
    }
    if (previousRequirePricing === undefined) {
      delete process.env.USAGE_BILLING_REQUIRE_PRICING;
    } else {
      process.env.USAGE_BILLING_REQUIRE_PRICING = previousRequirePricing;
    }
  }
});
