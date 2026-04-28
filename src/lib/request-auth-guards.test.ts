import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const testDataDir = mkdtempSync(join(tmpdir(), "travel-auth-guards-"));
const testPublicDir = mkdtempSync(join(tmpdir(), "travel-runtime-assets-"));

Object.assign(process.env, {
  NODE_ENV: "development",
  DEV_CANONICAL_HOSTNAME: "127.0.0.1",
  TRAVEL_DATA_DIR: testDataDir,
  TRAVEL_PUBLIC_STORAGE_DIR: testPublicDir,
});

process.on("exit", () => {
  rmSync(testDataDir, { recursive: true, force: true });
  rmSync(testPublicDir, { recursive: true, force: true });
});

let modulesPromise: Promise<{
  authConfig: any;
  authSecurity: any;
  authService: any;
  authStore: any;
  directorVideoGenerationStore: any;
  productArchiveStore: any;
  requestAuthGuards: any;
  runtimeAssetResponse: any;
  videoMaterialStore: any;
  videoTaskStore: any;
}> | null = null;

function loadModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import("./auth-route-config.js"),
      import("./auth-security.js"),
      import("./auth-service.js"),
      import("./auth-store.js"),
      import("./director-video-generation-store.js"),
      import("./product-archive-store.js"),
      import("./request-auth-guards.js"),
      import("./runtime-asset-response.js"),
      import("./video-material-store.js"),
      import("./video-task-store.js"),
    ]).then(([
      authConfig,
      authSecurity,
      authService,
      authStore,
      directorVideoGenerationStore,
      productArchiveStore,
      requestAuthGuards,
      runtimeAssetResponse,
      videoMaterialStore,
      videoTaskStore,
    ]) => ({
      authConfig,
      authSecurity,
      authService,
      authStore,
      directorVideoGenerationStore,
      productArchiveStore,
      requestAuthGuards,
      runtimeAssetResponse,
      videoMaterialStore,
      videoTaskStore,
    }));
  }

  return modulesPromise;
}

function buildRequest(
  url: string,
  init?: {
    headers?: Record<string, string>;
    method?: string;
  },
) {
  const headers = new Headers(init?.headers);
  const nextUrl = new URL(url) as URL & { clone(): URL };
  const cookieEntries = (headers.get("cookie") ?? "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const separatorIndex = chunk.indexOf("=");
      if (separatorIndex === -1) {
        return null;
      }

      return [chunk.slice(0, separatorIndex), chunk.slice(separatorIndex + 1)] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);
  const cookieMap = new Map(cookieEntries);

  nextUrl.clone = () => new URL(nextUrl.toString());

  return {
    cookies: {
      get(name: string) {
        const value = cookieMap.get(name);
        return value === undefined ? undefined : { name, value };
      },
    },
    headers,
    method: init?.method ?? "GET",
    nextUrl,
    url: nextUrl.toString(),
  };
}

function setNodeEnv(value: string | undefined) {
  Reflect.set(process.env, "NODE_ENV", value);
}

function createAuthenticatedUserSession(authStore: any, authSecurity: any, suffix: string) {
  const timestamp = new Date().toISOString();
  const userId = `user-${suffix}`;
  const sessionId = `usess-${suffix}`;
  const token = `token-${suffix}`;

  authStore.upsertAuthUser({
    avatar: null,
    certificationLabel: null,
    createdAt: timestamp,
    lastLoginAt: timestamp,
    lastLoginIp: "127.0.0.1",
    mergedIntoUserId: null,
    nickname: `测试用户${suffix}`,
    planLevel: null,
    quotaScope: "limited",
    status: "normal",
    updatedAt: timestamp,
    userId,
  });
  authStore.upsertUserSession({
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ip: "127.0.0.1",
    lastSeenAt: timestamp,
    loginType: "password",
    revokedAt: null,
    revokedReason: null,
    sessionId,
    tokenHash: authSecurity.sha256(token),
    userAgent: "node:test",
    userId,
  });

  return { token, userId };
}

function writeRuntimeAsset(relativePath: string, content: string) {
  const absolutePath = join(testPublicDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

test("shared protected route config covers authenticated user sections", async () => {
  const { authConfig } = await loadModules();

  assert.equal(authConfig.isUserProtectedPath("/assets/video-materials"), true);
  assert.equal(authConfig.isUserProtectedPath("/studio/task-creation"), true);
  assert.equal(authConfig.isUserProtectedPath("/login"), false);
  assert.equal(authConfig.isPublicApiPath("/api/auth/login/password"), true);
  assert.equal(authConfig.isPublicApiPath("/api/video-materials"), false);
});

test("request auth guard normalizes localhost HTML requests to the canonical dev host", async () => {
  const { requestAuthGuards } = await loadModules();
  const request = buildRequest("http://localhost:3000/assets/video-materials", {
    headers: {
      accept: "text/html",
    },
  });

  const response = await requestAuthGuards.applyRequestAuthGuards(request);

  assert.ok(response);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://127.0.0.1:3000/assets/video-materials");
});

test("request auth guard redirects protected pages without a user session", async () => {
  const { requestAuthGuards } = await loadModules();
  const request = buildRequest("http://127.0.0.1:3000/assets/video-materials", {
    headers: {
      accept: "text/html",
    },
  });

  const response = await requestAuthGuards.applyRequestAuthGuards(request);

  assert.ok(response);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://127.0.0.1:3000/login");
});

test("request auth guard returns 401 for protected user APIs without a session", async () => {
  const { requestAuthGuards } = await loadModules();
  const request = buildRequest("http://127.0.0.1:3000/api/video-materials");

  const response = await requestAuthGuards.applyRequestAuthGuards(request);

  assert.ok(response);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "UNAUTHORIZED",
    error: "用户未登录。",
    redirectTo: "/login",
  });
});

test("request auth guard allows protected pages after a valid login probe", async () => {
  const { authConfig, authSecurity, authService, authStore, requestAuthGuards } = await loadModules();
  const loginResult = createAuthenticatedUserSession(authStore, authSecurity, "valid");

  const session = authService.getUserSessionByToken(loginResult.token);
  assert.ok(session);
  assert.equal(session.userId, loginResult.userId);

  const originalFetch = global.fetch;
  const previousNodeEnv = process.env.NODE_ENV;
  global.fetch = async () =>
    new Response(JSON.stringify({ authenticated: true }), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    });

  try {
    setNodeEnv("production");
    const request = buildRequest("http://127.0.0.1:3000/assets/video-materials", {
      headers: {
        accept: "text/html",
        cookie: `${authConfig.USER_SESSION_COOKIE}=${loginResult.token}`,
      },
    });

    const response = await requestAuthGuards.applyRequestAuthGuards(request);

    assert.equal(response, null);
  } finally {
    setNodeEnv(previousNodeEnv);
    global.fetch = originalFetch;
  }
});

test("request auth guard clears invalid user sessions after a failed probe", async () => {
  const { authConfig, authSecurity, authStore, requestAuthGuards } = await loadModules();
  const loginResult = createAuthenticatedUserSession(authStore, authSecurity, "invalid");

  const originalFetch = global.fetch;
  const previousNodeEnv = process.env.NODE_ENV;
  global.fetch = async () =>
    new Response(JSON.stringify({ authenticated: false }), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    });

  try {
    setNodeEnv("production");
    const request = buildRequest("http://127.0.0.1:3000/assets/video-materials", {
      headers: {
        accept: "text/html",
        cookie: `${authConfig.USER_SESSION_COOKIE}=${loginResult.token}`,
      },
    });

    const response = await requestAuthGuards.applyRequestAuthGuards(request);

    assert.ok(response);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "http://127.0.0.1:3000/login");
    assert.equal(response.cookies.get(authConfig.USER_SESSION_COOKIE)?.value, "");
  } finally {
    setNodeEnv(previousNodeEnv);
    global.fetch = originalFetch;
  }
});

test("request auth guard skips middleware login probes for protected user pages in development", async () => {
  const { authConfig, authSecurity, authStore, requestAuthGuards } = await loadModules();
  const loginResult = createAuthenticatedUserSession(authStore, authSecurity, "dev-skip");

  const originalFetch = global.fetch;
  let fetchCallCount = 0;
  global.fetch = async () => {
    fetchCallCount += 1;
    throw new Error("middleware probe should be skipped in development");
  };

  try {
    setNodeEnv("development");
    const request = buildRequest("http://127.0.0.1:3000/assets/video-materials", {
      headers: {
        accept: "text/html",
        cookie: `${authConfig.USER_SESSION_COOKIE}=${loginResult.token}`,
      },
    });

    const response = await requestAuthGuards.applyRequestAuthGuards(request);

    assert.equal(response, null);
    assert.equal(fetchCallCount, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runtime asset response blocks unauthenticated generated task assets", async () => {
  const { runtimeAssetResponse, videoTaskStore } = await loadModules();
  const task = videoTaskStore.createVideoTask({
    ownerUserId: "user-ownerless-check",
    title: "测试任务",
    source: {
      productInfoSnapshot: "测试商品",
      userPrompt: "",
      videoTemplatePrompt: "",
    },
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: "",
    },
    parameters: {
      image: {},
      video: {
        videoType: "agency_guide_voiceover",
      },
      audio: {},
      constraints: {},
    },
  });
  writeRuntimeAsset(`generated-images/${task.taskId}/preview.txt`, "private-task-asset");

  const response = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/generated-images/${task.taskId}/preview.txt`),
    "generated-images",
    [task.taskId, "preview.txt"],
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "UNAUTHORIZED",
    error: "用户未登录或登录已失效。",
    redirectTo: "/login",
  });
});

test("runtime asset response enforces task ownership and marks task assets as private", async () => {
  const { authConfig, authSecurity, authStore, runtimeAssetResponse, videoTaskStore } = await loadModules();
  const owner = createAuthenticatedUserSession(authStore, authSecurity, "task-owner");
  const other = createAuthenticatedUserSession(authStore, authSecurity, "task-other");
  const task = videoTaskStore.createVideoTask({
    ownerUserId: owner.userId,
    title: "有归属任务",
    source: {
      productInfoSnapshot: "测试商品",
      userPrompt: "",
      videoTemplatePrompt: "",
    },
    draftBundle: {
      textToImagePrompt: "",
      imageToVideoPrompt: "",
      narrationScript: "",
    },
    parameters: {
      image: {},
      video: {
        videoType: "agency_guide_voiceover",
      },
      audio: {},
      constraints: {},
    },
  });
  writeRuntimeAsset(`generated-videos/${task.taskId}/preview.txt`, "owner-only-video");

  const forbiddenResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/generated-videos/${task.taskId}/preview.txt`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${other.token}`,
      },
    }),
    "generated-videos",
    [task.taskId, "preview.txt"],
  );
  assert.equal(forbiddenResponse.status, 403);
  assert.deepEqual(await forbiddenResponse.json(), {
    code: "VIDEO_TASK_FORBIDDEN",
    error: "无权访问该视频任务产物",
  });

  const allowedResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/generated-videos/${task.taskId}/preview.txt`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${owner.token}`,
      },
    }),
    "generated-videos",
    [task.taskId, "preview.txt"],
  );
  assert.equal(allowedResponse.status, 200);
  assert.equal(await allowedResponse.text(), "owner-only-video");
  assert.equal(allowedResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(allowedResponse.headers.get("vary"), "Cookie");
  assert.equal(allowedResponse.headers.get("x-content-type-options"), "nosniff");
});

test("runtime asset response authorizes director quick generation assets by session ownership", async () => {
  const { authConfig, authSecurity, authStore, directorVideoGenerationStore, runtimeAssetResponse } = await loadModules();
  const owner = createAuthenticatedUserSession(authStore, authSecurity, "director-owner");
  const other = createAuthenticatedUserSession(authStore, authSecurity, "director-other");
  const generationSession = directorVideoGenerationStore.createDirectorVideoGenerationSession({
    ownerUserId: owner.userId,
    title: "快速生成",
  });
  writeRuntimeAsset(
    `generated-images/${generationSession.sessionId}/video-generation/preview.txt`,
    "director-session-image",
  );

  const forbiddenResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/generated-images/${generationSession.sessionId}/video-generation/preview.txt`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${other.token}`,
      },
    }),
    "generated-images",
    [generationSession.sessionId, "video-generation", "preview.txt"],
  );
  assert.equal(forbiddenResponse.status, 403);
  assert.deepEqual(await forbiddenResponse.json(), {
    code: "DIRECTOR_VIDEO_GENERATION_FORBIDDEN",
    error: "无权访问该快速生成产物",
  });

  const allowedResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/generated-images/${generationSession.sessionId}/video-generation/preview.txt`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${owner.token}`,
      },
    }),
    "generated-images",
    [generationSession.sessionId, "video-generation", "preview.txt"],
  );
  assert.equal(allowedResponse.status, 200);
  assert.equal(await allowedResponse.text(), "director-session-image");
  assert.equal(allowedResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(allowedResponse.headers.get("vary"), "Cookie");
});

test("runtime asset response enforces product archive file ownership", async () => {
  const { authConfig, authSecurity, authStore, productArchiveStore, runtimeAssetResponse } = await loadModules();
  const owner = createAuthenticatedUserSession(authStore, authSecurity, "archive-owner");
  const other = createAuthenticatedUserSession(authStore, authSecurity, "archive-other");
  const archive = productArchiveStore.createProductArchive({ ownerUserId: owner.userId });
  writeRuntimeAsset(`product-archives/${archive.archiveId}/source/cover.txt`, "archive-source-image");

  const forbiddenResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/product-archives/${archive.archiveId}/source/cover.txt`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${other.token}`,
      },
    }),
    "product-archives",
    [archive.archiveId, "source", "cover.txt"],
  );
  assert.equal(forbiddenResponse.status, 403);
  assert.deepEqual(await forbiddenResponse.json(), {
    code: "PRODUCT_ARCHIVE_FORBIDDEN",
    error: "无权访问该商品档案文件",
  });

  const allowedResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/product-archives/${archive.archiveId}/source/cover.txt`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${owner.token}`,
      },
    }),
    "product-archives",
    [archive.archiveId, "source", "cover.txt"],
  );
  assert.equal(allowedResponse.status, 200);
  assert.equal(await allowedResponse.text(), "archive-source-image");
  assert.equal(allowedResponse.headers.get("cache-control"), "private, no-store");
});

test("runtime asset response infers video material ownership from file name", async () => {
  const { authConfig, authSecurity, authStore, runtimeAssetResponse, videoMaterialStore } = await loadModules();
  const owner = createAuthenticatedUserSession(authStore, authSecurity, "material-owner");
  const other = createAuthenticatedUserSession(authStore, authSecurity, "material-other");
  const material = videoMaterialStore.createVideoMaterial("", { ownerUserId: owner.userId });
  writeRuntimeAsset(`video-materials/${material.materialId}.wav`, "material-audio");

  const forbiddenResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/video-materials/${material.materialId}.wav`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${other.token}`,
      },
    }),
    "video-materials",
    [`${material.materialId}.wav`],
  );
  assert.equal(forbiddenResponse.status, 403);
  assert.deepEqual(await forbiddenResponse.json(), {
    code: "VIDEO_MATERIAL_FORBIDDEN",
    error: "无权访问该素材文件",
  });

  const allowedResponse = runtimeAssetResponse.serveRuntimeAssetRequest(
    buildRequest(`http://127.0.0.1:3000/video-materials/${material.materialId}.wav`, {
      headers: {
        cookie: `${authConfig.USER_SESSION_COOKIE}=${owner.token}`,
      },
    }),
    "video-materials",
    [`${material.materialId}.wav`],
  );
  assert.equal(allowedResponse.status, 200);
  assert.equal(await allowedResponse.text(), "material-audio");
  assert.equal(allowedResponse.headers.get("cache-control"), "private, no-store");
});
