import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TaskNextStepButton, type TaskStepActionState } from "./task-ui";

function renderButtonLabel(state: TaskStepActionState) {
  return renderToStaticMarkup(<TaskNextStepButton state={state} />);
}

test("TaskNextStepButton 会为真实运行但暂无进度的任务显示 1% 兜底", () => {
  const html = renderButtonLabel({
    label: "生成中...",
    isRunning: true,
    progressPercent: null,
    onAction: () => undefined,
  });

  assert.match(html, /生成中\.\.\. 1%/);
});

test("TaskNextStepButton 在状态加载态不展示任务进度百分比", () => {
  const html = renderButtonLabel({
    label: "任务状态加载中...",
    isRunning: true,
    busyDisplay: "status",
    progressPercent: 80,
    onAction: () => undefined,
  });

  assert.match(html, /任务状态加载中\.\.\./);
  assert.doesNotMatch(html, /80%/);
});
