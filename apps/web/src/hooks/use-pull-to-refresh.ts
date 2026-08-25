"use client";

import { useEffect, useRef, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";
const PULL_THRESHOLD = 72;
const MAX_PULL_DISTANCE = 112;

type PullState = "IDLE" | "PULLING" | "READY" | "REFRESHING" | "ERROR";

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea"));
}

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [distance, setDistance] = useState(0);
  const [state, setState] = useState<PullState>("IDLE");
  const onRefreshRef = useRef(onRefresh);
  const stateRef = useRef<PullState>("IDLE");
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const pullDistance = useRef(0);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const setPullState = (nextState: PullState) => {
      stateRef.current = nextState;
      setState(nextState);
    };
    const reset = () => {
      startPoint.current = null;
      pullDistance.current = 0;
      setDistance(0);
      setPullState("IDLE");
    };
    const isMobile = () => window.matchMedia?.(MOBILE_QUERY).matches ?? window.innerWidth <= 767;

    const handleTouchStart = (event: TouchEvent) => {
      if (
        !isMobile() ||
        stateRef.current === "REFRESHING" ||
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        isInteractiveTarget(event.target)
      ) {
        startPoint.current = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      startPoint.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const start = startPoint.current;
      const touch = event.touches[0];
      if (!start || !touch || window.scrollY > 0) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (deltaY <= 0 || Math.abs(deltaX) > deltaY * 0.75) {
        reset();
        return;
      }

      event.preventDefault();
      const nextDistance = Math.min(MAX_PULL_DISTANCE, deltaY * 0.5);
      pullDistance.current = nextDistance;
      setDistance(nextDistance);
      setPullState(nextDistance >= PULL_THRESHOLD ? "READY" : "PULLING");
    };

    const handleTouchEnd = () => {
      if (!startPoint.current) return;
      startPoint.current = null;
      if (pullDistance.current < PULL_THRESHOLD) {
        reset();
        return;
      }

      pullDistance.current = 48;
      setDistance(48);
      setPullState("REFRESHING");
      void onRefreshRef
        .current()
        .then(reset)
        .catch(() => {
          pullDistance.current = 48;
          setDistance(48);
          setPullState("ERROR");
          resetTimer.current = window.setTimeout(reset, 1600);
        });
    };

    const handleTouchCancel = () => {
      if (stateRef.current !== "REFRESHING") reset();
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  return { distance, state };
}
