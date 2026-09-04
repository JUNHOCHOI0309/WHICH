"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import type { OpsMediaLibraryPair } from "./contracts";
import styles from "./ops-management.module.css";

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(body.message || "Library 요청에 실패했습니다.");
  return body;
}

export function OpsAdminMediaLibrary() {
  const [library, setLibrary] = useState<OpsMediaLibraryPair[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    categoryCode: "LIFE",
    topics: "",
    assetAId: "",
    assetBId: "",
    altA: "",
    altB: "",
    sourceA: "",
    sourceB: "",
    authorName: "WHICH Editorial",
    licenseName: "Owned",
    licenseVersion: "1",
    evidenceReference: "which://operator-upload",
  });

  const load = useCallback(async () => {
    const body = await json<{ items: OpsMediaLibraryPair[] }>(
      await fetch("/api/ops/media-library", { cache: "no-store" }),
    );
    setLibrary(body.items.filter((item) => Array.isArray(item.assets)));
  }, []);

  useEffect(() => {
    // State is updated after the operator request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((error) =>
      toast.error(error instanceof Error ? error.message : "Library를 불러오지 못했습니다."),
    );
  }, [load]);

  async function registerPair() {
    const required = [
      form.title,
      form.categoryCode,
      form.assetAId,
      form.assetBId,
      form.altA,
      form.altB,
      form.sourceA,
      form.sourceB,
      form.authorName,
      form.licenseName,
      form.licenseVersion,
      form.evidenceReference,
    ];
    if (required.some((value) => !value.trim())) {
      toast.error("A/B 자산과 출처·라이선스 정보를 모두 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const common = {
        authorName: form.authorName.trim(),
        licenseName: form.licenseName.trim(),
        licenseVersion: form.licenseVersion.trim(),
        acquiredAt: new Date().toISOString(),
        commercialAllowed: true,
        derivativeAllowed: true,
        redistributionAllowed: true,
        evidenceReference: form.evidenceReference.trim(),
      };
      await json(
        await fetch("/api/ops/media-library", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: form.title.trim(),
            categoryCode: form.categoryCode.trim(),
            topics: form.topics
              .split(",")
              .map((topic) => topic.trim())
              .filter(Boolean),
            assets: [
              {
                ...common,
                side: "A",
                mediaAssetId: form.assetAId.trim(),
                altText: form.altA.trim(),
                cropMode: "COVER",
                sourceUrl: form.sourceA.trim(),
              },
              {
                ...common,
                side: "B",
                mediaAssetId: form.assetBId.trim(),
                altText: form.altB.trim(),
                cropMode: "COVER",
                sourceUrl: form.sourceB.trim(),
              },
            ],
          }),
        }),
      );
      setForm((current) => ({
        ...current,
        title: "",
        topics: "",
        assetAId: "",
        assetBId: "",
        altA: "",
        altB: "",
        sourceA: "",
        sourceB: "",
      }));
      toast.success("관리자 이미지 A/B 쌍을 Library에 공개했습니다.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Library 등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function revokePair(pair: OpsMediaLibraryPair) {
    const reason = window.prompt("Library 회수 사유를 입력해 주세요.");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const result = await json<{ fallbackIssueCount: number }>(
        await fetch(`/api/ops/media-library/${pair.id}/revoke`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      );
      toast.success(`${result.fallbackIssueCount}개 질문을 텍스트 표시로 전환했습니다.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Library 회수에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, placeholder: string) => (
    <input
      value={form[key]}
      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      placeholder={placeholder}
    />
  );

  return (
    <section className={styles.libraryOps}>
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>ADMIN IMAGE LIBRARY</p>
          <h2>관리자 질문 이미지 Library</h2>
        </div>
        <span>관리자 질문에서 즉시 승인한 이미지 자산을 재사용 쌍으로 관리합니다.</span>
      </div>
      <details className={styles.libraryDetails}>
        <summary>새 A/B 이미지 쌍 등록</summary>
        <div className={styles.libraryForm}>
          {field("title", "이미지 쌍 이름")}
          {field("categoryCode", "카테고리 코드")}
          {field("topics", "검색 주제 (쉼표 구분)")}
          {field("assetAId", "A Asset ID")}
          {field("altA", "A 대체 텍스트")}
          {field("sourceA", "A 원본 출처 URL")}
          {field("assetBId", "B Asset ID")}
          {field("altB", "B 대체 텍스트")}
          {field("sourceB", "B 원본 출처 URL")}
          {field("authorName", "저작자")}
          {field("licenseName", "라이선스 이름")}
          {field("licenseVersion", "라이선스 버전")}
          {field("evidenceReference", "권리 증빙 URL 또는 문서 참조")}
          <p>등록하면 상업적 이용·수정·재배포 권리를 확인한 것으로 처리됩니다.</p>
          <button type="button" disabled={busy} onClick={() => void registerPair()}>
            Library 공개
          </button>
        </div>
      </details>
      <div className={styles.libraryCards}>
        {library.map((pair) => (
          <article key={pair.id}>
            <div>
              {pair.assets.map((asset) => (
                <img
                  key={asset.id}
                  src={asset.url}
                  alt={asset.altText}
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
            <strong>{pair.title}</strong>
            <small>
              {pair.categoryCode} · 사용 {pair.usageCount}건
            </small>
            <button type="button" disabled={busy} onClick={() => void revokePair(pair)}>
              회수·텍스트 전환
            </button>
          </article>
        ))}
        {!library.length ? <p className={styles.empty}>공개된 Library 이미지가 없습니다.</p> : null}
      </div>
    </section>
  );
}
