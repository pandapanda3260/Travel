import { RouteLoadingShell } from "../_components/route-loading-shell";

export default function AdminLoading() {
  return (
    <RouteLoadingShell
      pageName="Admin"
      title="管理后台加载中..."
      description="正在进入管理后台并同步运营账号权限。"
    />
  );
}
