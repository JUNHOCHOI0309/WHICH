"use client";

import { useEffect, useState } from "react";

import styles from "./floating-top-button.module.css";

const SHOW_AFTER_PX = 480;

export function FloatingTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY >= SHOW_AFTER_PX);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  const moveToTop = () => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  return (
    <button
      className={styles.button}
      data-visible={visible}
      type="button"
      aria-label="페이지 맨 위로 이동"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={moveToTop}
    >
      TOP
    </button>
  );
}
