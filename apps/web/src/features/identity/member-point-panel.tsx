"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import type {
  MemberPointLedgerItem,
  MemberPointShopView,
  MemberPointView,
  PointShopCatalogItem,
} from "@/lib/contracts";
import styles from "./member-profile-experience.module.css";
import { MemberPointShopModal } from "./member-point-shop-modal";

import bronzeBadge from "../../../../mobile/assets/badges/bronze.webp";
import diamondBadge from "../../../../mobile/assets/badges/diamond.webp";
import goldBadge from "../../../../mobile/assets/badges/gold.webp";
import platinumBadge from "../../../../mobile/assets/badges/platinum.webp";
import silverBadge from "../../../../mobile/assets/badges/silver.webp";

const badgeImages = {
  BRONZE: bronzeBadge,
  SILVER: silverBadge,
  GOLD: goldBadge,
  PLATINUM: platinumBadge,
  DIAMOND: diamondBadge,
} as const;

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
    !body.badge ||
    typeof body.badge.progress !== "number" ||
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

export function MemberPointPanel({
  onShopChange,
}: {
  onShopChange?: (shop: MemberPointShopView) => void;
} = {}) {
  const [points, setPoints] = useState<MemberPointView | null>(null);
  const [screen, setScreen] = useState<PointScreen>("loading");
  const [morePending, setMorePending] = useState(false);
  const [shop, setShop] = useState<MemberPointShopView | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopPending, setShopPending] = useState(false);
  const [previewItem, setPreviewItem] = useState<PointShopCatalogItem | null>(null);

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
                badge: next.badge,
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

  const openShop = useCallback(async () => {
    setShopOpen(true);
    setShopPending(true);
    try {
      const response = await fetch("/api/me/point-shop", { cache: "no-store" });
      if (!response.ok) throw new Error("shop unavailable");
      const next = (await response.json()) as MemberPointShopView;
      setShop(next);
      setPreviewItem((current) => current ?? next.catalog[0] ?? null);
      onShopChange?.(next);
    } catch {
      toast.error("W Point 상점을 불러오지 못했어요.");
    } finally {
      setShopPending(false);
    }
  }, [onShopChange]);

  const mutateItem = useCallback(
    async (item: PointShopCatalogItem) => {
      setShopPending(true);
      try {
        const response = await fetch(
          item.equipped
            ? `/api/me/point-shop/equipment/${encodeURIComponent(item.equipSlot)}`
            : item.owned
              ? `/api/me/point-shop/equipment/${encodeURIComponent(item.equipSlot)}`
              : "/api/me/point-shop/purchases",
          {
            method: item.equipped ? "DELETE" : item.owned ? "PUT" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              item.owned
                ? { itemId: item.id }
                : { itemId: item.id, idempotencyKey: crypto.randomUUID() },
            ),
          },
        );
        const body = (await response.json()) as { message?: string };
        if (!response.ok) throw new Error(body.message ?? "상점 요청 실패");
        toast.success(
          item.equipped
            ? "장착을 해제했습니다."
            : item.owned
              ? "상품을 장착했습니다."
              : "상품을 구매했습니다.",
        );
        const [nextShop, nextPoints] = await Promise.all([
          fetch("/api/me/point-shop", { cache: "no-store" }),
          readPoints(),
        ]);
        if (nextShop.ok) {
          const next = (await nextShop.json()) as MemberPointShopView;
          setShop(next);
          onShopChange?.(next);
        }
        if (nextPoints) setPoints(nextPoints);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "상점 요청에 실패했습니다.");
      } finally {
        setShopPending(false);
      }
    },
    [onShopChange],
  );

  return (
    <>
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
            <button type="button" className={styles.pointMore} onClick={() => void openShop()}>
              W Point 상점
            </button>
            {points.account.hasPendingRecovery ? (
              <p className={styles.pointRecovery}>
                일부 기록을 다시 확인하고 있어 현재 사용할 수 있는 잔액만 표시합니다.
              </p>
            ) : null}
            <div className={styles.pointBadgeSummary}>
              {points.badge.current ? (
                <Image
                  src={badgeImages[points.badge.current.code]}
                  alt={`${points.badge.current.label} W Point 배지`}
                  width={104}
                  height={104}
                />
              ) : (
                <div className={styles.pointBadgePending}>첫 적립 후 배지 획득</div>
              )}
              <div>
                <strong>{points.badge.current?.label ?? "배지 준비 중"}</strong>
                <span>
                  {points.badge.next
                    ? `${points.badge.next.label}까지 ${Math.max(0, points.badge.next.minimumLifetimePoints - points.account.lifetimeEarned).toLocaleString("ko-KR")}P`
                    : "최고 등급 달성"}
                </span>
                <div
                  className={styles.pointBadgeProgress}
                  role="progressbar"
                  aria-label="다음 W Point 배지 진행률"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(points.badge.progress * 100)}
                >
                  <i style={{ width: `${Math.round(points.badge.progress * 100)}%` }} />
                </div>
              </div>
            </div>
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
      <MemberPointShopModal
        onAction={(item) => void mutateItem(item)}
        onClose={() => setShopOpen(false)}
        onPreview={setPreviewItem}
        pending={shopPending}
        previewItem={previewItem}
        shop={shop}
        visible={shopOpen}
      />
    </>
  );
}
