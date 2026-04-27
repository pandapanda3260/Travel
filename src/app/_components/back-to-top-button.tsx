"use client";

import { useEffect, useState } from "react";

export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 320);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <button
      type="button"
      className={`global-back-to-top ${visible ? "is-visible" : ""}`}
      aria-label="返回页面顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <span className="global-back-to-top-icon">↑</span>
    </button>
  );
}
