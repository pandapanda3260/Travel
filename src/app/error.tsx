"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div className="error-boundary-fallback">
      <p className="error-boundary-title">页面发生错误</p>
      <p className="error-boundary-message">{error.message}</p>
      <button className="error-boundary-reset" onClick={reset}>
        重试
      </button>
    </div>
  );
}
