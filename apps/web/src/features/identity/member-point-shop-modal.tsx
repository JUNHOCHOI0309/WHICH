"use client";

import { useEffect } from "react";

import type { MemberPointShopView, PointShopCatalogItem } from "@/lib/contracts";
import {
  avatarFrameStyle,
  cosmeticTokens,
  profileAccentStyle,
  shareBackgroundStyle,
} from "@/lib/point-shop-cosmetics";

import styles from "./member-profile-experience.module.css";

const slotLabels = {
  PROFILE_ACCENT: "프로필 컬러",
  AVATAR_FRAME: "아바타 프레임",
  SHARE_BACKGROUND: "공유 배경",
} as const;

function CosmeticPreview({ item }: { item: PointShopCatalogItem | null }) {
  if (!item) {
    return (
      <div className={styles.shopPreviewEmpty}>
        <strong>상품을 선택해 주세요.</strong>
        <span>목록의 상품을 누르면 실제 적용 모습을 먼저 확인할 수 있어요.</span>
      </div>
    );
  }

  const tokens = cosmeticTokens(item.themeFamily);

  return (
    <div className={styles.shopPreviewStage}>
      <div className={styles.shopPreviewMeta}>
        <span>{slotLabels[item.equipSlot]}</span>
        <strong>{item.name}</strong>
        <p>{item.description}</p>
      </div>

      {item.equipSlot === "PROFILE_ACCENT" ? (
        <div className={styles.shopProfileMock} style={profileAccentStyle(item)}>
          <div className={styles.shopAvatarMock}>W</div>
          <div>
            <span>PRIVATE MEMBER PROFILE</span>
            <strong>WHICH 회원님의 선택</strong>
            <i style={{ background: tokens.accent }} />
          </div>
        </div>
      ) : null}

      {item.equipSlot === "AVATAR_FRAME" ? (
        <div className={styles.shopAvatarPreview}>
          <div style={avatarFrameStyle(item)}>
            <span>W</span>
          </div>
          <strong>프로필 이미지 프레임</strong>
          <small>프로필과 댓글의 아바타에 적용됩니다.</small>
        </div>
      ) : null}

      {item.equipSlot === "SHARE_BACKGROUND" ? (
        <div className={styles.shopShareMock} style={shareBackgroundStyle(item)}>
          <span>WHICH · RESULT</span>
          <strong>당신의 선택은 어느 쪽인가요?</strong>
          <div>
            <b>A · 42%</b>
            <b>B · 58%</b>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MemberPointShopModal({
  onAction,
  onClose,
  onPreview,
  pending,
  previewItem,
  shop,
  visible,
}: {
  onAction: (item: PointShopCatalogItem) => void;
  onClose: () => void;
  onPreview: (item: PointShopCatalogItem) => void;
  pending: boolean;
  previewItem: PointShopCatalogItem | null;
  shop: MemberPointShopView | null;
  visible: boolean;
}) {
  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, visible]);

  if (!visible) return null;

  return (
    <div className={styles.shopModalBackdrop} onMouseDown={onClose}>
      <section
        aria-labelledby="point-shop-title"
        aria-modal="true"
        className={styles.shopModal}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className={styles.shopModalHeader}>
          <div>
            <p>W POINT SHOP</p>
            <h2 id="point-shop-title">나만의 WHICH를 골라보세요.</h2>
          </div>
          <div className={styles.shopModalHeaderActions}>
            <strong>{shop?.balance.toLocaleString("ko-KR") ?? "—"}P</strong>
            <button type="button" onClick={onClose} aria-label="W Point 상점 닫기">
              ×
            </button>
          </div>
        </header>

        <div className={styles.shopModalBody}>
          <div className={styles.shopModalPreviewColumn}>
            <p className={styles.shopSectionLabel}>LIVE PREVIEW</p>
            <CosmeticPreview item={previewItem} />
            {previewItem ? (
              <button
                className={styles.shopPrimaryAction}
                disabled={pending}
                onClick={() => onAction(previewItem)}
                type="button"
              >
                {previewItem.equipped
                  ? "장착 해제"
                  : previewItem.owned
                    ? "이 상품 장착"
                    : `${previewItem.price.toLocaleString("ko-KR")}P로 구매`}
              </button>
            ) : null}
          </div>

          <div className={styles.shopModalCatalogColumn}>
            <div className={styles.shopCatalogHeading}>
              <div>
                <p className={styles.shopSectionLabel}>CATALOG</p>
                <strong>꾸미기 상품</strong>
              </div>
            </div>

            {pending && !shop ? <p className={styles.shopLoading}>상품을 불러오는 중…</p> : null}
            <div className={styles.shopCatalogGrid}>
              {shop?.catalog.map((item) => {
                const tokens = cosmeticTokens(item.themeFamily);
                return (
                  <button
                    aria-pressed={previewItem?.id === item.id}
                    className={styles.shopProductCard}
                    data-selected={previewItem?.id === item.id}
                    key={item.id}
                    onClick={() => onPreview(item)}
                    type="button"
                  >
                    <i style={{ background: tokens.background, borderColor: tokens.border }} />
                    <span>{slotLabels[item.equipSlot]}</span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.equipped
                        ? "장착 중"
                        : item.owned
                          ? "보유 중"
                          : `${item.price.toLocaleString("ko-KR")}P`}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
