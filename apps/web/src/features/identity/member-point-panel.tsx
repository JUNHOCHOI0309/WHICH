"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import type { MemberPointLedgerItem, MemberPointView } from "@/lib/contracts";

import styles from "./member-profile-experience.module.css";

type PointScreen = "loading" | "ready" | "error";

async function readPoints(cursor?: string) {
  const query = new URLSearchParams({ limit: "5" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/me/points?${query}`, { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Point read failed");
  const body = (await response.json()) as Partial<MemberPointView>;
  if (
    !body.account ||
    typeof body.account.balance !== "number" ||
    typeof body.account.todayEarned !== "number" ||
    !body.ledger ||
    !Array.isArray(body.ledger.items)
  ) {
    throw new Error("Point response invalid");
  }
  return body as MemberPointView;
}

function pointDateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function pointAmountLabel(item: MemberPointLedgerItem) {
  return `${item.amount > 0 ? "+" : ""}${item.amount.toLocaleString("ko-KR")}P`;
}

export function MemberPointPanel() {
  const [points, setPoints] = useState<MemberPointView | null>(null);
  const [screen, setScreen] = useState<PointScreen>("loading");
  const [morePending, setMorePending] = useState(false);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const next = await readPoints();
      setPoints(next);
      setScreen(next ? "ready" : "error");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void readPoints()
      .then((next) => {
        if (!active) return;
        setPoints(next);
        setScreen(next ? "ready" : "error");
      })
      .catch(() => {
        if (active) setScreen("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!points?.ledger.nextCursor || morePending) return;
    setMorePending(true);
    void readPoints(points.ledger.nextCursor)
      .then((next) => {
        if (!next) return;
        setPoints((current) =>
          current
            ? {
                account: next.account,
                ledger: {
                  items: [...current.ledger.items, ...next.ledger.items],
                  nextCursor: next.ledger.nextCursor,
                },
              }
            : next,
        );
      })
      .catch(() => toast.error("W Point 내역을 더 불러오지 못했어요."))
      .finally(() => setMorePending(false));
  }, [morePending, points]);

  return (
    <section
      className={`${styles.pointPanel} ${styles.pointPanelRail}`}
      aria-labelledby="point-title"
    >
      <div className={styles.pointHeading}>
        <div>
          <p>W POINT</p>
          <h2 id="point-title">나의 W Point</h2>
        </div>
        {screen === "ready" && points ? (
          <div className={styles.pointBalance}>
            <strong>{points.account.balance.toLocaleString("ko-KR")}P</strong>
            <span>오늘 +{points.account.todayEarned.toLocaleString("ko-KR")}P</span>
          </div>
        ) : null}
      </div>

      {screen === "loading" ? (
        <div className={styles.pointState} aria-busy="true" aria-live="polite">
          W Point를 확인하고 있어요.
        </div>
      ) : null}
      {screen === "error" ? (
        <div className={styles.pointState} role="status">
          <span>W Point만 잠시 불러오지 못했어요. 다른 기능은 그대로 사용할 수 있습니다.</span>
          <button type="button" onClick={() => void load()}>
            다시 확인
          </button>
        </div>
      ) : null}
      {screen === "ready" && points ? (
        <>
          {points.account.hasPendingRecovery ? (
            <p className={styles.pointRecovery}>
              일부 기록을 다시 확인하고 있어 현재 사용할 수 있는 잔액만 표시합니다.
            </p>
          ) : null}
          {points.ledger.items.length === 0 ? (
            <div className={styles.pointEmpty}>
              <strong>아직 W Point 내역이 없어요.</strong>
              <span>로그인, 투표, 확인된 공유 활동부터 차곡차곡 기록됩니다.</span>
            </div>
          ) : (
            <ul className={styles.pointLedger}>
              {points.ledger.items.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.reasonLabel}</strong>
                    <time dateTime={item.createdAt}>{pointDateLabel(item.createdAt)}</time>
                  </div>
                  <span data-positive={item.amount > 0}>{pointAmountLabel(item)}</span>
                </li>
              ))}
            </ul>
          )}
          {points.ledger.nextCursor ? (
            <button
              type="button"
              className={styles.pointMore}
              disabled={morePending}
              onClick={loadMore}
            >
              {morePending ? "불러오는 중…" : "내역 더 보기"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
