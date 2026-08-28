"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import { WhichShell } from "@/components/layout/which-shell";
import type { MemberModerationCenter } from "@/lib/contracts";

import styles from "./member-moderation-experience.module.css";

type Screen = "loading" | "guest" | "ready" | "error";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "검수 대기",
  APPROVED: "승인",
  REJECTED: "반려",
  HIDDEN: "숨김",
  DELETED: "삭제",
  NEEDS_CHANGES: "수정 필요",
  SUBMITTED: "접수",
  IN_REVIEW: "사람 검토 중",
  UPHELD: "기존 조치 유지",
  OVERTURNED: "조치 변경·복원",
  ACTIONED: "보호 조치 완료",
  DISMISSED: "종결",
};

function dateTime(value: string | null) {
  if (!value) return "기한 별도 안내";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readCenter() {
  const response = await fetch("/api/me/moderation", { cache: "no-store" });
  if (response.status === 401) return null;
  const body = (await response.json()) as MemberModerationCenter & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "Moderation 상태를 불러오지 못했습니다.");
  return body;
}

export function MemberModerationExperience({
  creationEnabled = false,
}: {
  creationEnabled?: boolean;
}) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [center, setCenter] = useState<MemberModerationCenter | null>(null);
  const [appealTarget, setAppealTarget] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [rightsTarget, setRightsTarget] = useState<string | null>(null);
  const [rightsType, setRightsType] = useState<"PRIVACY" | "DEFAMATION" | "COPYRIGHT">("COPYRIGHT");
  const [rightsDetails, setRightsDetails] = useState("");
  const [replacementTarget, setReplacementTarget] = useState<string | null>(null);
  const [replacementA, setReplacementA] = useState<File | null>(null);
  const [replacementB, setReplacementB] = useState<File | null>(null);
  const [attestation, setAttestation] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const value = await readCenter();
      setCenter(value);
      setScreen(value ? "ready" : "guest");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void readCenter()
      .then((value) => {
        if (!active) return;
        setCenter(value);
        setScreen(value ? "ready" : "guest");
      })
      .catch(() => {
        if (active) setScreen("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const pendingCount = useMemo(
    () => center?.assets.filter((asset) => asset.assetReview.status === "PENDING").length ?? 0,
    [center],
  );

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) throw new Error(result.message ?? "요청을 처리하지 못했습니다.");
  }

  async function submitAppeal(assetId: string) {
    if (appealReason.trim().length < 20)
      return toast.error("재검토 이유를 20자 이상 입력해 주세요.");
    setBusy(true);
    try {
      await post("/api/me/moderation/appeals", {
        targetType: "ISSUE_MEDIA_ASSET",
        targetId: assetId,
        reason: appealReason.trim(),
      });
      toast.success("사람 재검토를 요청했어요.");
      setAppealTarget(null);
      setAppealReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "재검토 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRights(assetId: string) {
    if (rightsDetails.trim().length < 20)
      return toast.error("권리 요청 내용을 20자 이상 입력해 주세요.");
    setBusy(true);
    try {
      await post("/api/me/moderation/rights", {
        requestType: rightsType,
        targetType: "ISSUE_MEDIA_ASSET",
        targetId: assetId,
        details: rightsDetails.trim(),
      });
      toast.success("권리 요청을 별도 사건으로 접수했어요.");
      setRightsTarget(null);
      setRightsDetails("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "권리 요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseAlternative(submissionId: string, action: "TEXT_ONLY" | "CANCEL_IMAGE") {
    setBusy(true);
    try {
      await post(`/api/me/moderation/submissions/${submissionId}/asset-alternative`, { action });
      toast.success(
        action === "TEXT_ONLY" ? "이미지 없이 검토를 계속해요." : "이미지를 질문에서 제외했어요.",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "이미지 대안을 적용하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const form = new FormData();
    form.set("media", file);
    form.set("rightsAttestation", attestation.trim());
    const response = await fetch("/api/me/moderation/media", { method: "POST", body: form });
    const body = (await response.json()) as { asset?: { id: string }; message?: string };
    if (!response.ok || !body.asset)
      throw new Error(body.message ?? "이미지를 저장하지 못했습니다.");
    return body.asset.id;
  }

  async function replaceImages(submissionId: string) {
    if (!replacementA || !replacementB || attestation.trim().length < 20) {
      return toast.error("A/B 이미지와 20자 이상의 권리 확인을 입력해 주세요.");
    }
    setBusy(true);
    try {
      const [replacementAssetAId, replacementAssetBId] = await Promise.all([
        upload(replacementA),
        upload(replacementB),
      ]);
      await post(`/api/me/moderation/submissions/${submissionId}/asset-alternative`, {
        action: "REPLACE_IMAGE",
        replacementAssetAId,
        replacementAssetBId,
      });
      toast.success("새 이미지를 검수 대상으로 제출했어요.");
      setReplacementTarget(null);
      setReplacementA(null);
      setReplacementB(null);
      setAttestation("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "이미지 교체에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function applyLibrary(submissionId: string, first: string, second: string) {
    setBusy(true);
    try {
      await post(`/api/me/moderation/submissions/${submissionId}/asset-alternative`, {
        action: "APPROVED_LIBRARY",
        replacementAssetAId: first,
        replacementAssetBId: second,
      });
      toast.success("승인된 Library 이미지로 교체했어요.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Library 이미지 교체에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WhichShell active="me" creationEnabled={creationEnabled}>
      <main className={styles.page}>
        {screen === "loading" ? (
          <section className={styles.message}>Moderation 상태를 확인하고 있어요.</section>
        ) : null}
        {screen === "guest" ? (
          <section className={styles.message}>
            <h1>로그인하면 내 Moderation 상태를 확인할 수 있어요.</h1>
            <Link href="/login?returnTo=%2Fme%2Fmoderation">로그인</Link>
          </section>
        ) : null}
        {screen === "error" ? (
          <section className={styles.message} role="alert">
            <h1>상태를 불러오지 못했어요.</h1>
            <button onClick={() => void load()}>다시 불러오기</button>
          </section>
        ) : null}
        {screen === "ready" && center ? (
          <>
            <header className={styles.hero}>
              <div>
                <p>MY MODERATION</p>
                <h1>조치 이유와 다음 단계를 투명하게 확인해요.</h1>
              </div>
              <strong>{pendingCount}건 검수 대기</strong>
            </header>
            <nav className={styles.tabs} aria-label="내 기록 메뉴">
              <Link href="/me">프로필</Link>
              <Link href="/me/votes">투표 기록</Link>
              <Link aria-current="page" className={styles.active} href="/me/moderation">
                Moderation
              </Link>
            </nav>
            <section className={styles.section}>
              <div className={styles.heading}>
                <div>
                  <p>STATUS</p>
                  <h2>이미지와 질문 상태</h2>
                </div>
                <span>두 상태는 별도로 진행됩니다.</span>
              </div>
              {center.assets.length === 0 ? (
                <div className={styles.empty}>검수 중이거나 조치된 이미지가 없습니다.</div>
              ) : (
                <div className={styles.assetList}>
                  {center.assets.map((asset) => (
                    <article className={styles.assetCard} key={asset.assetId}>
                      <div className={styles.assetHeader}>
                        <div>
                          <span
                            className={`${styles.status} ${styles[asset.assetReview.status.toLowerCase()]}`}
                          >
                            {STATUS_LABELS[asset.assetReview.status]}
                          </span>
                          <h3>{asset.issueSubmission?.question ?? "질문 연결 전 이미지"}</h3>
                        </div>
                        <time>{dateTime(asset.assetReview.lastChangedAt)}</time>
                      </div>
                      <dl>
                        <div>
                          <dt>Issue 게시</dt>
                          <dd>
                            {asset.issueSubmission
                              ? STATUS_LABELS[asset.issueSubmission.publicationStatus]
                              : "연결 전"}
                          </dd>
                        </div>
                        <div>
                          <dt>Asset 검수</dt>
                          <dd>{STATUS_LABELS[asset.assetReview.status]}</dd>
                        </div>
                        <div>
                          <dt>정책·이유</dt>
                          <dd>
                            {asset.assetReview.policyVersion} · {asset.assetReview.reasonCode}
                          </dd>
                        </div>
                        <div>
                          <dt>제출 시각</dt>
                          <dd>{dateTime(asset.assetReview.submittedAt)}</dd>
                        </div>
                      </dl>
                      {asset.assetReview.status === "PENDING" && asset.issueSubmission ? (
                        <div className={styles.actions}>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void chooseAlternative(asset.issueSubmission!.id, "TEXT_ONLY")
                            }
                          >
                            Text-only로 계속
                          </button>
                          {center.libraryAssets.length >= 2 ? (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void applyLibrary(
                                  asset.issueSubmission!.id,
                                  center.libraryAssets[0]!.assetId,
                                  center.libraryAssets[1]!.assetId,
                                )
                              }
                            >
                              승인 Library 교체
                            </button>
                          ) : null}
                          <button
                            disabled={busy}
                            onClick={() => setReplacementTarget(asset.issueSubmission!.id)}
                          >
                            이미지 변경
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void chooseAlternative(asset.issueSubmission!.id, "CANCEL_IMAGE")
                            }
                          >
                            이미지 취소
                          </button>
                        </div>
                      ) : null}
                      {replacementTarget === asset.issueSubmission?.id ? (
                        <div className={styles.inlineForm}>
                          <label>
                            A 이미지
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(event) => setReplacementA(event.target.files?.[0] ?? null)}
                            />
                          </label>
                          <label>
                            B 이미지
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(event) => setReplacementB(event.target.files?.[0] ?? null)}
                            />
                          </label>
                          <label className={styles.wide}>
                            권리 확인
                            <textarea
                              value={attestation}
                              onChange={(event) => setAttestation(event.target.value)}
                              placeholder="직접 촬영했거나 게시 권리를 보유한 이미지임을 확인합니다."
                            />
                          </label>
                          <button
                            disabled={busy}
                            onClick={() => void replaceImages(asset.issueSubmission!.id)}
                          >
                            변경 이미지 제출
                          </button>
                        </div>
                      ) : null}
                      {["REJECTED", "HIDDEN", "DELETED"].includes(asset.assetReview.status) ? (
                        <div className={styles.actions}>
                          <button
                            disabled={busy || Boolean(asset.appealId)}
                            onClick={() => setAppealTarget(asset.assetId)}
                          >
                            {asset.appealId ? "재검토 접수됨" : "사람 재검토 요청"}
                          </button>
                          <button disabled={busy} onClick={() => setRightsTarget(asset.assetId)}>
                            Rights 절차
                          </button>
                        </div>
                      ) : null}
                      {appealTarget === asset.assetId ? (
                        <div className={styles.inlineForm}>
                          <label className={styles.wide}>
                            재검토 이유
                            <textarea
                              value={appealReason}
                              onChange={(event) => setAppealReason(event.target.value)}
                            />
                          </label>
                          <button disabled={busy} onClick={() => void submitAppeal(asset.assetId)}>
                            접수
                          </button>
                        </div>
                      ) : null}
                      {rightsTarget === asset.assetId ? (
                        <div className={styles.inlineForm}>
                          <label>
                            권리 유형
                            <select
                              value={rightsType}
                              onChange={(event) =>
                                setRightsType(event.target.value as typeof rightsType)
                              }
                            >
                              <option value="PRIVACY">개인정보</option>
                              <option value="DEFAMATION">명예훼손</option>
                              <option value="COPYRIGHT">저작권</option>
                            </select>
                          </label>
                          <label className={styles.wide}>
                            요청 및 증빙 설명
                            <textarea
                              value={rightsDetails}
                              onChange={(event) => setRightsDetails(event.target.value)}
                            />
                          </label>
                          <button disabled={busy} onClick={() => void submitRights(asset.assetId)}>
                            권리 사건 접수
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className={styles.section}>
              <div className={styles.heading}>
                <div>
                  <p>NOTICE</p>
                  <h2>통지와 최종 결과</h2>
                </div>
                <span>신고자와 내부 탐지 세부사항은 공개하지 않습니다.</span>
              </div>
              {center.notices.length === 0 ? (
                <div className={styles.empty}>새 통지가 없습니다.</div>
              ) : (
                <ol className={styles.noticeList}>
                  {center.notices.map((notice) => (
                    <li key={notice.id}>
                      <div>
                        <strong>{notice.summary}</strong>
                        <span>{notice.nextStep}</span>
                      </div>
                      <small>
                        {notice.reasonCode} · {dateTime(notice.effectiveAt)}
                      </small>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className={styles.caseGrid}>
              <article>
                <p>APPEAL</p>
                <h2>제품 재검토</h2>
                {center.appeals.length ? (
                  center.appeals.map((item) => (
                    <div className={styles.caseItem} key={item.id}>
                      <strong>{STATUS_LABELS[item.status]}</strong>
                      <span>{item.resolution ?? item.reason}</span>
                      <small>{dateTime(item.updatedAt)}</small>
                    </div>
                  ))
                ) : (
                  <span>접수된 재검토 요청이 없습니다.</span>
                )}
              </article>
              <article>
                <p>RIGHTS</p>
                <h2>권리 사건</h2>
                {center.rightsCases.length ? (
                  center.rightsCases.map((item) => (
                    <div className={styles.caseItem} key={item.id}>
                      <strong>
                        {item.requestType} · {STATUS_LABELS[item.status]}
                      </strong>
                      <span>{item.resolution ?? item.details}</span>
                      <small>
                        처리 목표 {dateTime(item.dueAt)} · Legal hold{" "}
                        {dateTime(item.legalHoldUntil)}
                      </small>
                    </div>
                  ))
                ) : (
                  <span>접수된 권리 사건이 없습니다.</span>
                )}
              </article>
            </section>
          </>
        ) : null}
      </main>
    </WhichShell>
  );
}
