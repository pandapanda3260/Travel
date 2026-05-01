import { RouteLoadingShell } from "../../_components/route-loading-shell";

export default function TaskCreationLoading() {
  return (
    <RouteLoadingShell
      pageName="Task Creation"
      title="任务工作流加载中..."
      description="正在进入素材成片工作流并加载任务列表。"
    />
  );
}
