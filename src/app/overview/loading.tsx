import { RouteLoadingShell } from "../_components/route-loading-shell";

export default function OverviewLoading() {
  return (
    <RouteLoadingShell
      pageName="Overview"
      title="概览页加载中..."
      description="正在进入工作台概览并加载服务状态。"
    />
  );
}
