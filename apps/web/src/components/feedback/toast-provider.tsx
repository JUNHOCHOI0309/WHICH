"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./toast-provider.module.css";

export type ToastTone = "success" | "info" | "error";

type ToastInput = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastItem = Required<Pick<ToastInput, "message" | "tone">> & {
  id: string;
  durationMs: number;
};

const TOAST_EVENT = "which:toast";
const FLASH_KEY = "which:toast-flash";
const MAX_TOASTS = 2;

function normalize(input: ToastInput): Required<ToastInput> {
  const tone = input.tone ?? "info";
  return {
    message: input.message.trim(),
    tone,
    durationMs: input.durationMs ?? (tone === "error" ? 6000 : 4000),
  };
}

function emit(input: ToastInput) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT, { detail: input }));
}

export const toast = {
  show: emit,
  success(message: string, durationMs?: number) {
    emit({ message, tone: "success", durationMs });
  },
  info(message: string, durationMs?: number) {
    emit({ message, tone: "info", durationMs });
  },
  error(message: string, durationMs?: number) {
    emit({ message, tone: "error", durationMs });
  },
  flash(input: ToastInput) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(FLASH_KEY, JSON.stringify(normalize(input)));
  },
};

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const present = useCallback(
    (input: ToastInput) => {
      const next = normalize(input);
      if (!next.message) return;
      const id = crypto.randomUUID();

      setItems((current) => {
        if (current.some((item) => item.message === next.message && item.tone === next.tone)) {
          return current;
        }
        return [...current, { ...next, id }].slice(-MAX_TOASTS);
      });

      const timer = setTimeout(() => dismiss(id), next.durationMs);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const handleToast = (event: Event) => present((event as CustomEvent<ToastInput>).detail);
    window.addEventListener(TOAST_EVENT, handleToast);

    const flash = window.sessionStorage.getItem(FLASH_KEY);
    if (flash) {
      window.sessionStorage.removeItem(FLASH_KEY);
      try {
        const parsed = JSON.parse(flash) as ToastInput;
        queueMicrotask(() => present(parsed));
      } catch {
        // Ignore malformed values left by an older client.
      }
    }

    const url = new URL(window.location.href);
    if (url.searchParams.get("auth") === "success") {
      queueMicrotask(() => present({ message: "로그인했어요.", tone: "success" }));
      url.searchParams.delete("auth");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, [present]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return (
    <>
      {children}
      <div className={styles.viewport} aria-label="알림">
        {items.map((item) => (
          <div
            key={item.id}
            className={styles.toast}
            data-tone={item.tone}
            role={item.tone === "error" ? "alert" : "status"}
          >
            <span className={styles.icon} aria-hidden="true">
              {item.tone === "success" ? "✓" : item.tone === "error" ? "!" : "i"}
            </span>
            <p>{item.message}</p>
            <button type="button" onClick={() => dismiss(item.id)} aria-label="알림 닫기">
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
