import { RouteLoadingShell } from "../../_components/route-loading-shell";

export default function VideoGenerationLoading() {
  return (
    <RouteLoadingShell
      pageName="Quick Generation"
      title="快速生成加载中..."
      description="正在进入快速生成流水线并加载生成记录。"
    />
  );
}
