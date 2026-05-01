import { RouteLoadingShell } from "../_components/route-loading-shell";

export default function ModelsLoading() {
  return (
    <RouteLoadingShell
      pageName="Models"
      title="模型页面加载中..."
      description="正在进入模型定制页面并加载当前账号数据。"
    />
  );
}
