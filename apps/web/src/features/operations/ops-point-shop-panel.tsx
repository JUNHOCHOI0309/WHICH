"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  OpsPointShopEquipSlot,
  OpsPointShopItem,
  OpsPointShopStatus,
  OpsPointShopThemeFamily,
  OpsPointShopView,
} from "./contracts";
import styles from "./ops-management.module.css";

const slotLabels: Record<OpsPointShopEquipSlot, string> = {
  PROFILE_ACCENT: "프로필 컬러",
  AVATAR_FRAME: "아바타 프레임",
  SHARE_BACKGROUND: "공유 배경",
};
const themeLabels: Record<OpsPointShopThemeFamily, string> = {
  SIGNAL_GRID: "Signal Grid",
  PAPER_VOTE: "Paper Vote",
  NEON_RIFT: "Neon Rift",
  SOFT_ORBIT: "Soft Orbit",
};
const statusLabels: Record<OpsPointShopStatus, string> = {
  ACTIVE: "판매 중",
  PAUSED: "판매 중지",
  RETIRED: "Archive",
};

type CreateForm = {
  code: string;
  equipSlot: OpsPointShopEquipSlot;
  themeFamily: OpsPointShopThemeFamily;
  name: string;
  description: string;
  price: string;
  status: "ACTIVE" | "PAUSED";
  reason: string;
};

const initialCreateForm: CreateForm = {
  code: "",
  equipSlot: "PROFILE_ACCENT",
  themeFamily: "SIGNAL_GRID",
  name: "",
  description: "",
  price: "",
  status: "PAUSED",
  reason: "신규 꾸미기 상품 등록",
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function auditSummary(entry: OpsPointShopView["audit"][number]) {
  const metadata = entry.metadata;
  const code = typeof metadata.code === "string" ? metadata.code : "상품";
  const before =
    typeof metadata.before === "object" && metadata.before ? metadata.before : undefined;
  const after = typeof metadata.after === "object" && metadata.after ? metadata.after : undefined;
  const beforeRecord = before as Record<string, unknown> | undefined;
  const afterRecord = after as Record<string, unknown> | undefined;
  if (entry.eventType === "OPS_POINT_SHOP_ITEM_CREATED") {
    return `${code} 생성 · ${String(afterRecord?.price ?? "-")}P · ${String(afterRecord?.status ?? "-")}`;
  }
  return `${code} 변경 · ${String(beforeRecord?.price ?? "-")}P/${String(beforeRecord?.status ?? "-")} → ${String(afterRecord?.price ?? "-")}P/${String(afterRecord?.status ?? "-")}`;
}

export function OpsPointShopPanel() {
  const [view, setView] = useState<OpsPointShopView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const [editReason, setEditReason] = useState("");
  const [createForm, setCreateForm] = useState<CreateForm>(initialCreateForm);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => view?.items.find((item) => item.id === selectedId) ?? null,
    [selectedId, view],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ops/point-shop", { cache: "no-store" });
      const body = (await response.json()) as OpsPointShopView & { message?: string };
      if (!response.ok) throw new Error(body.message || "상점 운영 정보를 불러오지 못했습니다.");
      setView(body);
      setSelectedId((current) =>
        current && body.items.some((item) => item.id === current)
          ? current
          : (body.items[0]?.id ?? null),
      );
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "상점 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // State updates happen only after the remote request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected || selected.status === "RETIRED") return;
    // A catalog selection resets the controlled edit draft to its persisted values.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditPrice(String(selected.price));
    setEditStatus(selected.status);
    setEditReason("");
  }, [selected]);

  async function updateItem() {
    if (!selected) return;
    const price = Number(editPrice);
    if (!Number.isInteger(price) || price < 1) {
      setError("가격은 1P 이상의 정수여야 합니다.");
      return;
    }
    if (editReason.trim().length < 8) {
      setError("변경 사유를 8자 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/ops/point-shop/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: selected.updatedAt,
          price,
          status: editStatus,
          reason: editReason.trim(),
        }),
      });
      const body = (await response.json()) as OpsPointShopItem & { message?: string };
      if (!response.ok) throw new Error(body.message || "상품을 변경하지 못했습니다.");
      setMessage(`${body.name}의 판매 설정을 변경했습니다.`);
      setError("");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "상품을 변경하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function createItem() {
    const price = Number(createForm.price);
    if (!Number.isInteger(price) || price < 1) {
      setError("가격은 1P 이상의 정수여야 합니다.");
      return;
    }
    if (createForm.reason.trim().length < 8) {
      setError("등록 사유를 8자 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/ops/point-shop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...createForm,
          code: createForm.code.trim().toUpperCase(),
          name: createForm.name.trim(),
          description: createForm.description.trim(),
          reason: createForm.reason.trim(),
          price,
        }),
      });
      const body = (await response.json()) as OpsPointShopItem & { message?: string };
      if (!response.ok) throw new Error(body.message || "상품을 생성하지 못했습니다.");
      setCreateForm(initialCreateForm);
      setShowCreate(false);
      setSelectedId(body.id);
      setMessage(`${body.name} 상품을 생성했습니다.`);
      setError("");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "상품을 생성하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.page} aria-labelledby="point-shop-title">
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>POINT SHOP CONTROL</p>
          <h1 id="point-shop-title">W Point 상품 관리</h1>
        </div>
        <span>가격과 판매 상태 변경은 구매 Snapshot을 수정하지 않습니다.</span>
      </div>

      <div className={styles.counts} aria-label="상품 상태별 개수">
        {(["ACTIVE", "PAUSED", "RETIRED"] as const).map((status) => (
          <article key={status}>
            <span>{statusLabels[status]}</span>
            <strong>{view?.counts[status] ?? 0}</strong>
          </article>
        ))}
        <button
          type="button"
          className={styles.createButton}
          onClick={() => setShowCreate((current) => !current)}
        >
          {showCreate ? "생성 닫기" : "+ 새 상품"}
        </button>
      </div>

      {message ? <p className={styles.successNotice}>{message}</p> : null}
      {error ? <p className={styles.notice}>{error}</p> : null}

      {showCreate ? (
        <section className={styles.shopCreatePanel} aria-labelledby="shop-create-title">
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>NEW SKU</p>
              <h2 id="shop-create-title">새 꾸미기 상품</h2>
            </div>
            <span>초기값은 안전하게 판매 중지 상태를 권장합니다.</span>
          </div>
          <div className={styles.shopFormGrid}>
            <label>
              상품 코드
              <input
                value={createForm.code}
                placeholder="NEW_THEME_ACCENT"
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, code: event.target.value.toUpperCase() }))
                }
              />
            </label>
            <label>
              상품명
              <input
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, name: event.target.value }))
                }
              />
            </label>
            <label>
              상품 종류
              <select
                value={createForm.equipSlot}
                onChange={(event) =>
                  setCreateForm((form) => ({
                    ...form,
                    equipSlot: event.target.value as OpsPointShopEquipSlot,
                  }))
                }
              >
                {Object.entries(slotLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              테마 패밀리
              <select
                value={createForm.themeFamily}
                onChange={(event) =>
                  setCreateForm((form) => ({
                    ...form,
                    themeFamily: event.target.value as OpsPointShopThemeFamily,
                  }))
                }
              >
                {Object.entries(themeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              가격
              <input
                inputMode="numeric"
                value={createForm.price}
                placeholder="500"
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, price: event.target.value }))
                }
              />
            </label>
            <label>
              초기 판매 상태
              <select
                value={createForm.status}
                onChange={(event) =>
                  setCreateForm((form) => ({
                    ...form,
                    status: event.target.value as "ACTIVE" | "PAUSED",
                  }))
                }
              >
                <option value="PAUSED">판매 중지</option>
                <option value="ACTIVE">판매 중</option>
              </select>
            </label>
            <label className={styles.wideField}>
              설명
              <textarea
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, description: event.target.value }))
                }
              />
            </label>
            <label className={styles.wideField}>
              등록 사유
              <input
                value={createForm.reason}
                onChange={(event) =>
                  setCreateForm((form) => ({ ...form, reason: event.target.value }))
                }
              />
            </label>
          </div>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={createItem}
            disabled={saving}
          >
            {saving ? "저장 중" : "상품 생성"}
          </button>
        </section>
      ) : null}

      <div className={styles.shopOpsGrid}>
        <div className={styles.shopItemList} aria-label="상점 상품 목록">
          {loading ? <p className={styles.empty}>상품을 불러오고 있습니다.</p> : null}
          {view?.items.map((item) => (
            <button
              type="button"
              key={item.id}
              className={styles.shopItem}
              aria-pressed={selectedId === item.id}
              onClick={() => setSelectedId(item.id)}
            >
              <span>
                <strong>{item.name}</strong>
                <small>{item.code}</small>
              </span>
              <span>
                <strong>{item.price.toLocaleString("ko-KR")}P</strong>
                <small data-status={item.status}>{statusLabels[item.status]}</small>
              </span>
            </button>
          ))}
        </div>

        <section className={styles.shopDetail} aria-live="polite">
          {selected ? (
            <>
              <div className={styles.sectionTitle}>
                <div>
                  <p className={styles.eyebrow}>{slotLabels[selected.equipSlot]}</p>
                  <h2>{selected.name}</h2>
                </div>
                <span>누적 구매 {selected.purchaseCount.toLocaleString("ko-KR")}건</span>
              </div>
              <p className={styles.shopDescription}>{selected.description}</p>
              <dl className={styles.shopFacts}>
                <div>
                  <dt>테마</dt>
                  <dd>{themeLabels[selected.themeFamily]}</dd>
                </div>
                <div>
                  <dt>버전</dt>
                  <dd>v{selected.currentVersion}</dd>
                </div>
                <div>
                  <dt>최근 변경</dt>
                  <dd>{dateTime(selected.updatedAt)}</dd>
                </div>
              </dl>
              {selected.status === "RETIRED" ? (
                <p className={styles.notice}>Archive된 상품은 이 화면에서 재판매할 수 없습니다.</p>
              ) : (
                <div className={styles.shopEditForm}>
                  <label>
                    판매 가격
                    <input
                      inputMode="numeric"
                      value={editPrice}
                      onChange={(event) => setEditPrice(event.target.value)}
                    />
                  </label>
                  <label>
                    판매 상태
                    <select
                      value={editStatus}
                      onChange={(event) => setEditStatus(event.target.value as "ACTIVE" | "PAUSED")}
                    >
                      <option value="ACTIVE">판매 중</option>
                      <option value="PAUSED">판매 중지</option>
                    </select>
                  </label>
                  <label className={styles.wideField}>
                    변경 사유
                    <textarea
                      value={editReason}
                      placeholder="가격 또는 판매 상태를 변경하는 이유를 기록해 주세요."
                      onChange={(event) => setEditReason(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.primaryAction}
                    onClick={updateItem}
                    disabled={saving}
                  >
                    {saving ? "저장 중" : "변경 저장"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className={styles.empty}>관리할 상품을 선택해 주세요.</p>
          )}
        </section>
      </div>

      <section className={styles.auditPanel} aria-labelledby="point-shop-audit-title">
        <div className={styles.sectionTitle}>
          <div>
            <p className={styles.eyebrow}>AUDIT TRAIL</p>
            <h2 id="point-shop-audit-title">최근 상품 변경 기록</h2>
          </div>
          <span>최신 50건</span>
        </div>
        <div className={styles.auditList}>
          {view?.audit.length ? (
            view.audit.map((entry) => (
              <article key={entry.id}>
                <div>
                  <strong>{auditSummary(entry)}</strong>
                  <span>{String(entry.metadata.reason ?? "사유 없음")}</span>
                </div>
                <div>
                  <strong>{entry.operator}</strong>
                  <span>{dateTime(entry.occurredAt)}</span>
                </div>
              </article>
            ))
          ) : (
            <p className={styles.empty}>아직 상품 변경 감사 기록이 없습니다.</p>
          )}
        </div>
      </section>
    </section>
  );
}
