import { Suspense } from "react";

import AdminPromptsContent from "./AdminPromptsContent";

export default function AdminPromptsPage() {
  return (
    <Suspense fallback={<div className="admin-loading">加载中...</div>}>
      <AdminPromptsContent />
    </Suspense>
  );
}
