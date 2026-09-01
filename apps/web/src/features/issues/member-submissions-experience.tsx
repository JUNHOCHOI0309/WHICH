"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/feedback/toast-provider";
import { WhichShell } from "@/components/layout/which-shell";
import type { ChoiceCode, IssueMediaLibraryPair, MemberIssueSubmission } from "@/lib/contracts";
import { MemberProfileTabs } from "../identity/member-profile-tabs";
import { MemberPointPanel } from "../identity/member-point-panel";
import historyStyles from "../identity/member-history-layout.module.css";
import {
  actOnMemberSubmission,
  loadIssueMediaLibrary,
  loadMemberSubmissions,
  updateMemberSubmission,
  uploadIssueSubmissionMedia,
} from "./issue-creator-client";
import styles from "./member-submissions-experience.module.css";
import { submissionOutcome, submissionFailureReason } from "./submission-outcome";
import { SUBMISSION_UPDATED_EVENT, trackSubmission, forgetSubmission } from "./submission-feedback";

const labels = {
  PROCESSING: "처리 중",
  PUBLISHED: "게시 완료",
  NEEDS_CHANGES: "수정 필요",
  REJECTED: "게시 불가",
  QUARANTINED: "공개 보류",
  CANCELLED: "취소됨",
};

const CHOICE_CODES = ["A", "B", "C", "D"] as const;
const CHOICE_FIELD: Record<ChoiceCode, "choiceA" | "choiceB" | "choiceC" | "choiceD"> = {
  A: "choiceA",
  B: "choiceB",
  C: "choiceC",
  D: "choiceD",
};
const MEDIA_FIELD: Record<
  ChoiceCode,
  "mediaAssetAId" | "mediaAssetBId" | "mediaAssetCId" | "mediaAssetDId"
> = {
  A: "mediaAssetAId",
  B: "mediaAssetBId",
  C: "mediaAssetCId",
  D: "mediaAssetDId",
};

function emptyFiles(): Record<ChoiceCode, File | null> {
  return { A: null, B: null, C: null, D: null };
}

function submissionChoiceCodes(submission: MemberIssueSubmission) {
  return CHOICE_CODES.filter((code) => Boolean(submission[CHOICE_FIELD[code]]));
}

export function MemberSubmissionsExperience({
  creationEnabled = false,
}: {
  creationEnabled?: boolean;
}) {
  const [items, setItems] = useState<MemberIssueSubmission[]>([]);
  const [screen, setScreen] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editing, setEditing] = useState<MemberIssueSubmission | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<ChoiceCode, File | null>>(emptyFiles);
  const [libraryTarget, setLibraryTarget] = useState<MemberIssueSubmission | null>(null);
  const [library, setLibrary] = useState<IssueMediaLibraryPair[]>([]);
  const [librarySelections, setLibrarySelections] = useState<string[]>([]);
  const key = useRef("");
  const groups = useMemo(() => {
    const months = new Map<string, MemberIssueSubmission[]>();
    for (const item of [...items].sort(
      (a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt),
    )) {
      const date = new Date(item.submittedAt);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      months.set(month, [...(months.get(month) ?? []), item]);
    }
    return [...months];
  }, [items]);

  async function load() {
    try {
      setItems((await loadMemberSubmissions()).items);
      setScreen("ready");
    } catch (error) {
      setScreen((error as { status?: number }).status === 401 ? "guest" : "error");
    }
  }
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadMemberSubmissions()
        .then((result) => {
          if (active) {
            setItems(result.items);
            setScreen("ready");
          }
        })
        .catch((error) => {
          if (active) setScreen(error.status === 401 ? "guest" : "error");
        });
    };
    refresh();
    window.addEventListener(SUBMISSION_UPDATED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(SUBMISSION_UPDATED_EVENT, refresh);
    };
  }, []);

  async function run(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "처리하지 못했어요.");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function replace(item: MemberIssueSubmission) {
    setItems((current) => current.map((row) => (row.id === item.id ? item : row)));
    setEditing(null);
    setLibraryTarget(null);
    setFiles(emptyFiles());
    setLibrarySelections([]);
  }
  async function action(
    item: MemberIssueSubmission,
    kind: "TEXT_ONLY" | "LIBRARY" | "CANCEL" | "CHECK",
    pairId?: string,
    libraryAssetIds?: string[],
  ) {
    await run(async () => {
      const result = await actOnMemberSubmission(item, kind, pairId, libraryAssetIds);
      if (submissionOutcome(result.submission) !== "processing") forgetSubmission(item.id);
      replace(result.submission);
      toast.success(
        kind === "CANCEL"
          ? "제출을 취소했어요."
          : result.submission.publishedIssueId
            ? "질문이 게시되었어요."
            : "최신 상태를 확인했어요.",
      );
    });
  }
  async function save() {
    if (!editing) return;
    const choiceCodes = submissionChoiceCodes(editing);
    const hasOptionImages = choiceCodes.some(
      (code) => Boolean(files[code]) || Boolean(editing[MEDIA_FIELD[code]]),
    );
    if (
      hasOptionImages &&
      choiceCodes.some((code) => !files[code] && !editing[MEDIA_FIELD[code]])
    ) {
      return toast.error("선택지 이미지는 사용 중인 모든 선택지에 함께 등록해 주세요.");
    }
    await run(async () => {
      const mediaAssetIds: Record<ChoiceCode, string | null> = {
        A: editing.mediaAssetAId,
        B: editing.mediaAssetBId,
        C: editing.mediaAssetCId ?? null,
        D: editing.mediaAssetDId ?? null,
      };
      for (const code of choiceCodes) {
        const file = files[code];
        if (file) {
          // Sequential uploads preserve the single-active-session guard and failure handling.
          mediaAssetIds[code] = (await uploadIssueSubmissionMedia(editing.id, file)).asset.id;
        }
      }
      const replacingOptionImages = choiceCodes.some((code) => Boolean(files[code]));
      const result = await updateMemberSubmission(
        editing,
        {
          question: editing.question,
          context: editing.context || null,
          choiceA: editing.choiceA,
          choiceB: editing.choiceB,
          choiceC: editing.choiceC ?? null,
          choiceD: editing.choiceD ?? null,
          interestCardCode: editing.interestCardCode,
          contextMediaAssetId: replacingOptionImages ? null : (editing.contextMediaAssetId ?? null),
          mediaAssetAId: mediaAssetIds.A,
          mediaAssetBId: mediaAssetIds.B,
          mediaAssetCId: mediaAssetIds.C,
          mediaAssetDId: mediaAssetIds.D,
        },
        key.current,
      );
      replace(result.submission);
      if (submissionOutcome(result.submission) === "processing") trackSubmission(result.submission);
      toast.success("수정한 질문을 제출했어요.");
    });
  }

  return (
    <WhichShell
      active="me"
      creationEnabled={creationEnabled}
      aside={screen === "ready" ? <MemberPointPanel /> : undefined}
      preserveAsideOnNarrow={screen === "ready"}
    >
      <div className={`${historyStyles.page} ${styles.page}`}>
        <header className={historyStyles.hero}>
          <div>
            <p>MY QUESTIONS</p>
            <h1>내 질문</h1>
            <span>
              최근 제출한 질문 {screen === "ready" ? `${items.length}개` : "20개"} · 본인에게만
              보여요
            </span>
          </div>
        </header>
        <MemberProfileTabs active="submissions" />
        <div className={styles.noteRow}>
          <div className={styles.information}>
            <button
              type="button"
              className={styles.informationButton}
              aria-label="내 질문 안내"
              aria-describedby="submission-history-information"
            >
              <Image src="/icons/help.png" width={22} height={22} alt="" />
            </button>
            <p
              className={`${styles.note} ${styles.informationTooltip}`}
              id="submission-history-information"
              role="tooltip"
            >
              최근 제출한 질문을 최대 20개까지 보여요. 이미지를 검사하는 동안에도 수정하거나 이미지
              없이 게시할 수 있어요.
            </p>
          </div>
          <button
            type="button"
            className={styles.refreshButton}
            aria-label="새로고침"
            title="새로고침"
            disabled={busy || screen === "loading"}
            onClick={() => void run(load)}
          >
            <Image src="/icons/refresh-arrow.png" width={22} height={22} alt="" />
          </button>
        </div>
        {screen === "loading" ? <p role="status">질문을 불러오고 있어요.</p> : null}
        {screen === "guest" ? (
          <Link href="/login?returnTo=%2Fme%2Fsubmissions">로그인하고 내 질문 보기</Link>
        ) : null}
        {screen === "error" ? (
          <p role="alert">질문을 불러오지 못했어요. 새로고침으로 다시 시도해 주세요.</p>
        ) : null}
        {screen === "ready" && !items.length ? (
          <section className={historyStyles.empty}>
            <h2>아직 제출한 질문이 없어요.</h2>
            <p>질문을 만들면 게시 상태와 선택지를 이곳에서 확인할 수 있어요.</p>
            {creationEnabled ? <Link href="/create">질문 만들기</Link> : null}
          </section>
        ) : null}
        {screen === "ready" ? (
          <div className={historyStyles.monthList}>
            {groups.map(([month, submissions]) => (
              <section
                className={historyStyles.monthGroup}
                key={month}
                aria-labelledby={`submissions-${month}`}
              >
                <header>
                  <h2 id={`submissions-${month}`}>
                    {new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(
                      new Date(submissions[0]!.submittedAt),
                    )}
                  </h2>
                  <span>{submissions.length}개 질문</span>
                </header>
                <div className={`${historyStyles.timeline} ${styles.submissionTimeline}`}>
                  {submissions.map((item) => {
                    const editable =
                      !item.publishedIssueId && ["PENDING", "NEEDS_CHANGES"].includes(item.status);
                    const state =
                      item.publicationState ??
                      (item.status === "PENDING" || item.status === "APPROVED"
                        ? "PROCESSING"
                        : item.status);
                    const outcome = submissionOutcome(item);
                    const published = outcome === "published";
                    const failed = outcome === "failed";
                    return (
                      <article
                        className={`${historyStyles.timelineItem} ${styles.row}`}
                        data-published={published || undefined}
                        key={item.id}
                        aria-label={item.question}
                      >
                        <div className={historyStyles.voteCopy}>
                          <div className={historyStyles.voteMeta}>
                            <span>{item.interestCardCode.replaceAll("_", " ")}</span>
                            <time dateTime={item.submittedAt}>
                              {new Intl.DateTimeFormat("ko-KR", {
                                month: "short",
                                day: "numeric",
                              }).format(new Date(item.submittedAt))}
                            </time>
                          </div>
                          <h3>{item.question}</h3>
                          {item.context ? <p className={styles.context}>{item.context}</p> : null}
                          <div className={styles.choiceSummary}>
                            {submissionChoiceCodes(item).map((code) => (
                              <span key={code}>
                                <b>{code}</b> {item[CHOICE_FIELD[code]]}
                              </span>
                            ))}
                          </div>
                        </div>
                        {!published ? (
                          <div className={styles.submissionState}>
                            <strong className={styles.badge} data-state={state}>
                              {state === "PROCESSING" ? (
                                <span className={styles.processingSpinner} aria-hidden="true" />
                              ) : null}
                              {labels[state]}
                            </strong>
                            <small>수정본 {item.revision}</small>
                          </div>
                        ) : null}
                        {published ? (
                          <Link
                            aria-label={`${item.question} 게시된 질문 보기`}
                            title="게시된 질문 보기"
                            href={`/issues/${item.publishedIssueId}`}
                          >
                            <Image
                              src="/icons/double-chevron.png"
                              width={24}
                              height={24}
                              alt=""
                              aria-hidden="true"
                            />
                          </Link>
                        ) : null}
                        {editable && !failed ? (
                          <button
                            className={styles.manageButton}
                            type="button"
                            aria-label={`${item.question} 관리`}
                            aria-expanded={managingId === item.id}
                            aria-controls={`manage-${item.id}`}
                            disabled={busy}
                            onClick={() => {
                              setManagingId(managingId === item.id ? null : item.id);
                              setEditing(null);
                              setLibraryTarget(null);
                            }}
                          >
                            {managingId === item.id ? "접기" : "관리"}
                          </button>
                        ) : null}
                        {failed ? (
                          <p className={`${styles.note} ${styles.reviewNote}`}>
                            {submissionFailureReason(item)}
                          </p>
                        ) : null}
                        {failed || (editable && managingId === item.id) ? (
                          <div className={styles.actions} id={`manage-${item.id}`}>
                            <button
                              disabled={busy || !editable}
                              onClick={() => {
                                setEditing({ ...item });
                                setLibraryTarget(null);
                                setFiles(emptyFiles());
                                key.current = crypto.randomUUID();
                              }}
                            >
                              수정·이미지 변경
                            </button>
                            <button
                              disabled={busy || !editable}
                              onClick={() => {
                                if (window.confirm("이미지를 제외하고 이 질문을 바로 게시할까요?"))
                                  void action(item, "TEXT_ONLY");
                              }}
                            >
                              이미지 없이 게시
                            </button>
                            <button
                              disabled={busy || !editable}
                              onClick={() =>
                                void run(async () => {
                                  const result = await loadIssueMediaLibrary();
                                  setLibrary(result.items);
                                  setLibraryTarget(item);
                                  setLibrarySelections([]);
                                  setEditing(null);
                                })
                              }
                            >
                              Library로 교체
                            </button>
                            <button disabled={busy} onClick={() => void run(load)}>
                              게시 상태 확인
                            </button>
                            <button
                              disabled={busy || !editable}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "이 질문 제출을 취소할까요? 취소한 제출은 다시 게시되지 않아요.",
                                  )
                                )
                                  void action(item, "CANCEL");
                              }}
                            >
                              제출 취소
                            </button>
                          </div>
                        ) : null}
                        {failed && !editable ? (
                          <p className={styles.reviewNote}>
                            확정 처리된 질문은 수정하거나 취소할 수 없어요. 새 질문으로 작성해
                            주세요.
                          </p>
                        ) : null}
                        {editing?.id === item.id ? (
                          <form
                            className={styles.form}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void save();
                            }}
                          >
                            <label>
                              질문
                              <input
                                required
                                minLength={5}
                                maxLength={120}
                                value={editing.question}
                                onChange={(event) => {
                                  setEditing({ ...editing, question: event.target.value });
                                  key.current = crypto.randomUUID();
                                }}
                              />
                            </label>
                            <label>
                              짧은 설명
                              <textarea
                                maxLength={240}
                                value={editing.context ?? ""}
                                onChange={(event) => {
                                  setEditing({ ...editing, context: event.target.value });
                                  key.current = crypto.randomUUID();
                                }}
                              />
                            </label>
                            <div className={styles.choices}>
                              {submissionChoiceCodes(editing).map((code) => (
                                <label key={code}>
                                  {code} 선택지
                                  <input
                                    required
                                    maxLength={50}
                                    value={editing[CHOICE_FIELD[code]] ?? ""}
                                    onChange={(event) => {
                                      setEditing({
                                        ...editing,
                                        [CHOICE_FIELD[code]]: event.target.value,
                                      });
                                      key.current = crypto.randomUUID();
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                            <p className={styles.note}>
                              이미지를 바꾸지 않으면 기존 이미지를 유지합니다. 새 이미지는 업로드
                              권한과 안전 검사가 필요해요.
                            </p>
                            <div className={styles.choices}>
                              {submissionChoiceCodes(editing).map((code) => (
                                <label key={code}>
                                  {code} 새 이미지
                                  <input
                                    disabled={busy}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={(event) => {
                                      setFiles((current) => ({
                                        ...current,
                                        [code]: event.target.files?.[0] ?? null,
                                      }));
                                      key.current = crypto.randomUUID();
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                            <div className={styles.actions}>
                              <button className={styles.primary} disabled={busy} type="submit">
                                수정본 제출
                              </button>
                              <button
                                disabled={busy}
                                type="button"
                                onClick={() => setEditing(null)}
                              >
                                접기
                              </button>
                            </div>
                          </form>
                        ) : null}
                        {libraryTarget?.id === item.id ? (
                          <section className={styles.library} aria-label="승인된 이미지 선택">
                            {!library.length ? (
                              <p>지금 사용할 수 있는 Library 이미지가 없어요.</p>
                            ) : (
                              <>
                                <p className={styles.note}>
                                  이미지가 선택된 순서대로 {submissionChoiceCodes(item).join(" · ")}
                                  에 배치돼요. 서로 다른 묶음의 이미지도 함께 고를 수 있어요.
                                </p>
                                <div className={styles.libraryGrid}>
                                  {library.flatMap((pair) =>
                                    pair.assets.map((asset) => {
                                      const selectedIndex = librarySelections.indexOf(asset.id);
                                      const selectedCode =
                                        selectedIndex >= 0
                                          ? submissionChoiceCodes(item)[selectedIndex]
                                          : null;
                                      return (
                                        <button
                                          aria-pressed={selectedIndex >= 0}
                                          className={styles.libraryAsset}
                                          data-selected={selectedIndex >= 0 || undefined}
                                          disabled={busy}
                                          key={asset.id}
                                          type="button"
                                          onClick={() => {
                                            setLibrarySelections((current) => {
                                              if (current.includes(asset.id))
                                                return current.filter((id) => id !== asset.id);
                                              if (
                                                current.length >= submissionChoiceCodes(item).length
                                              ) {
                                                toast.error(
                                                  `이미지는 ${submissionChoiceCodes(item).length}개까지 고를 수 있어요.`,
                                                );
                                                return current;
                                              }
                                              return [...current, asset.id];
                                            });
                                          }}
                                        >
                                          <figure>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={asset.url} alt={asset.altText} />
                                            <figcaption>
                                              {selectedCode ? `${selectedCode} · ` : ""}
                                              {pair.title} · {asset.altText}
                                            </figcaption>
                                          </figure>
                                        </button>
                                      );
                                    }),
                                  )}
                                </div>
                                <button
                                  className={styles.primary}
                                  disabled={
                                    busy ||
                                    librarySelections.length !== submissionChoiceCodes(item).length
                                  }
                                  type="button"
                                  onClick={() => {
                                    if (window.confirm("선택한 Library 이미지로 바로 게시할까요?"))
                                      void action(item, "LIBRARY", undefined, librarySelections);
                                  }}
                                >
                                  선택한 이미지로 게시
                                </button>
                              </>
                            )}
                            <button
                              disabled={busy}
                              type="button"
                              onClick={() => {
                                setLibraryTarget(null);
                                setLibrarySelections([]);
                              }}
                            >
                              접기
                            </button>
                          </section>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </WhichShell>
  );
}
