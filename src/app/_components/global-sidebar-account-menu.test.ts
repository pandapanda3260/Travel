import assert from "node:assert/strict";
import test from "node:test";

import { buildSidebarAccountMenuState } from "./global-sidebar-account-menu";
import type { SidebarUserSummary } from "./global-sidebar-config";

const signedInUser: SidebarUserSummary = {
  userId: "user-test-001",
  nickname: "Mark",
  avatar: null,
  status: "active",
  planLevel: 5,
  certificationLabel: null,
  maskedPhone: "156****8369",
  activeSessionCount: 1,
  availablePoints: 200,
};

test("未登录或登录失效时侧栏账号入口仍渲染，并把主操作切换为登录", () => {
  const state = buildSidebarAccountMenuState(null);

  assert.equal(state.shouldRender, true);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.nickname, "");
  assert.equal(state.planLabel, "");
  assert.equal(state.avatarText, "");
  assert.equal(state.primaryActionLabel, "登录");
});

test("已登录用户侧栏账号入口保持原有会员与退出登录操作", () => {
  const state = buildSidebarAccountMenuState(signedInUser);

  assert.equal(state.shouldRender, true);
  assert.equal(state.isAuthenticated, true);
  assert.equal(state.nickname, "Mark");
  assert.equal(state.planLabel, "L5 会员");
  assert.equal(state.avatarText, "M");
  assert.equal(state.primaryActionLabel, "退出登录");
});
