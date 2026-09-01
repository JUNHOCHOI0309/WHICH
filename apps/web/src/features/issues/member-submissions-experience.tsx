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
  UPLOAD_INCOMPLETE: "업로드 미완료",
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

function useObjectUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

function submissionChoiceCodes(submission: MemberIssueSubmission) {
  return CHOICE_CODES.filter((code) => {
    const value = submission[CHOICE_FIELD[code]];
    return code === "A" || code === "B" || (value !== null && value !== undefined);
  });
}

function hasSubmissionMedia(submission: MemberIssueSubmission) {
  return Boolean(
    submission.contextMediaAssetId ||
    submissionChoiceCodes(submission).some((code) => submission[MEDIA_FIELD[code]]),
  );
}

function submissionFailureHeadline(submission: MemberIssueSubmission) {
  const codes = submissionChoiceCodes(submission);
  const hasChoiceImages = codes.some((code) => Boolean(submission[MEDIA_FIELD[code]]));
  return hasChoiceImages
    ? `${codes.join("/")} 이미지 중 하나 이상이 게시 기준을 통과하지 못했어요.`
    : "질문 내용이 게시 기준을 통과하지 못했어요.";
}

export function MemberSubmissionsExperience({
  creationEnabled = false,
}: {
  creationEnabled?: boolean;
}) {
  const [items, setItems] = useState<MemberIssueSubmission[]>([]);
  const [screen, setScreen] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editing, setEditing] = useState<MemberIssueSubmission | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<ChoiceCode, File | null>>(emptyFiles);
  const [contextFile, setContextFile] = useState<File | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<MemberIssueSubmission | null>(null);
  const [library, setLibrary] = useState<IssueMediaLibraryPair[]>([]);
  const [librarySelections, setLibrarySelections] = useState<string[]>([]);
  const key = useRef("");
  const contextPreview = useObjectUrl(contextFile);
  const filePreviewA = useObjectUrl(files.A);
  const filePreviewB = useObjectUrl(files.B);
  const filePreviewC = useObjectUrl(files.C);
  const filePreviewD = useObjectUrl(files.D);
  const filePreviews: Record<ChoiceCode, string | null> = {
    A: filePreviewA,
    B: filePreviewB,
    C: filePreviewC,
    D: filePreviewD,
  };
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)),
    [items],
  );
  const activeItems = useMemo(
    () => sortedItems.filter((item) => submissionOutcome(item) !== "cancelled"),
    [sortedItems],
  );
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return activeItems;
    return activeItems.filter((item) =>
      [item.question, item.context, item.choiceA, item.choiceB, item.choiceC, item.choiceD]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("ko-KR").includes(normalized)),
    );
  }, [activeItems, query]);

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
  useEffect(() => {
    if (!openMenuId) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest("[data-submission-actions-menu]")) {
        setOpenMenuId(null);
      }
    };
    const closeMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, [openMenuId]);

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
    setOpenMenuId(null);
    setLibraryTarget(null);
    setFiles(emptyFiles());
    setContextFile(null);
    setLibrarySelections([]);
  }
  async function action(
    item: MemberIssueSubmission,
    kind: "TEXT_ONLY" | "LIBRARY" | "CANCEL" | "DELETE" | "CHECK",
    pairId?: string,
    libraryAssetIds?: string[],
  ) {
    await run(async () => {
      const result = await actOnMemberSubmission(item, kind, pairId, libraryAssetIds);
      if (result.deleted) {
        setItems((current) => current.filter((row) => row.id !== item.id));
        setEditing(null);
        setOpenMenuId(null);
        setLibraryTarget(null);
        forgetSubmission(item.id);
        toast.success(
          item.publishedIssueId
            ? "게시된 질문을 삭제했어요. 기존 참여 기록은 안전하게 보존돼요."
            : "게시 실패한 질문과 연결된 데이터를 삭제했어요.",
        );
        return;
      }
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
      let contextMediaAssetId = editing.contextMediaAssetId ?? null;
      if (contextFile) {
        contextMediaAssetId = (await uploadIssueSubmissionMedia(editing.id, contextFile)).asset.id;
      }
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
          contextMediaAssetId,
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
              최근 제출한 질문 {screen === "ready" ? `${activeItems.length}개` : "20개"} ·
              본인에게만 보여요
            </span>
          </div>
        </header>
        <MemberProfileTabs active="submissions" />
        <div className={styles.noteRow}>
          <input
            className={styles.searchInput}
            type="search"
            aria-label="내 질문 검색"
            placeholder="질문 또는 선택지 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className={styles.noteControls}>
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
                최근 제출한 질문을 최대 20개까지 보여요. 이미지를 검사하는 동안에도 수정하거나
                이미지 없이 게시할 수 있어요.
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
        </div>
        {screen === "loading" ? <p role="status">질문을 불러오고 있어요.</p> : null}
        {screen === "guest" ? (
          <Link href="/login?returnTo=%2Fme%2Fsubmissions">로그인하고 내 질문 보기</Link>
        ) : null}
        {screen === "error" ? (
          <p role="alert">질문을 불러오지 못했어요. 새로고침으로 다시 시도해 주세요.</p>
        ) : null}
        {screen === "ready" && !activeItems.length ? (
          <section className={historyStyles.empty}>
            <h2>아직 제출한 질문이 없어요.</h2>
            <p>질문을 만들면 게시 상태와 선택지를 이곳에서 확인할 수 있어요.</p>
            {creationEnabled ? <Link href="/create">질문 만들기</Link> : null}
          </section>
        ) : null}
        {screen === "ready" && activeItems.length > 0 && !visibleItems.length ? (
          <section className={historyStyles.empty}>
            <h2>검색 결과가 없어요.</h2>
            <p>다른 질문이나 선택지로 검색해 보세요.</p>
          </section>
        ) : null}
        {screen === "ready" && visibleItems.length > 0 ? (
          <div className={styles.cardList}>
            {visibleItems.map((item) => {
              const editable =
                !item.publishedIssueId && ["PENDING", "NEEDS_CHANGES"].includes(item.status);
              const uploadIncomplete =
                item.status === "PENDING" &&
                item.publicationState === "PROCESSING" &&
                !hasSubmissionMedia(item);
              const state = uploadIncomplete
                ? "UPLOAD_INCOMPLETE"
                : (item.publicationState ??
                  (item.status === "PENDING" || item.status === "APPROVED"
                    ? "PROCESSING"
                    : item.status));
              const outcome = submissionOutcome(item);
              const published = outcome === "published";
              const failed = outcome === "failed";
              const removable = failed && !item.publishedIssueId;
              const imageReviewFailed = failed && hasSubmissionMedia(item);
              const menuOpen = openMenuId === item.id;
              return (
                <article
                  className={styles.submissionCard}
                  data-published={published || undefined}
                  key={item.id}
                  aria-label={item.question}
                >
                  <div className={styles.cardCopy}>
                    <div className={styles.cardMeta}>
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
                    <div className={styles.publishedActions}>
                      <button
                        className={styles.publishedDeleteButton}
                        type="button"
                        aria-label={`${item.question} 삭제`}
                        title="게시된 질문 삭제"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "게시된 질문을 삭제할까요? 공개 화면과 피드에서 즉시 내려가며 기존 투표·댓글 기록은 보존됩니다.",
                            )
                          )
                            void action(item, "DELETE");
                        }}
                      >
                        <Image
                          src="/icons/delete.png"
                          width={20}
                          height={20}
                          alt=""
                          aria-hidden="true"
                        />
                      </button>
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
                    </div>
                  ) : null}
                  {failed || uploadIncomplete ? (
                    <div className={styles.reviewWarning} role="status">
                      <Image
                        className={styles.warningIcon}
                        src={imageReviewFailed ? "/icons/ban.png" : "/icons/attention.png"}
                        width={22}
                        height={22}
                        alt=""
                        aria-hidden="true"
                      />
                      <div>
                        <strong>
                          {uploadIncomplete
                            ? "이미지 업로드를 완료하지 못했어요."
                            : submissionFailureHeadline(item)}
                        </strong>
                        <span>
                          {uploadIncomplete
                            ? "이미지 수정을 눌러 필요한 이미지를 다시 선택해 주세요."
                            : submissionFailureReason(item)}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {editable || removable ? (
                    <div className={styles.cardActions}>
                      {editable ? (
                        <>
                          <button
                            className={styles.editImageButton}
                            disabled={busy}
                            type="button"
                            onClick={() => {
                              setEditing({ ...item });
                              setOpenMenuId(null);
                              setLibraryTarget(null);
                              setFiles(emptyFiles());
                              setContextFile(null);
                              key.current = crypto.randomUUID();
                            }}
                          >
                            <Image
                              className={`${styles.actionIcon} ${styles.editActionIcon}`}
                              src="/icons/pencil.png"
                              width={18}
                              height={18}
                              alt=""
                              aria-hidden="true"
                            />
                            이미지 수정
                          </button>
                          <button
                            className={styles.textOnlyButton}
                            disabled={busy}
                            type="button"
                            onClick={() => {
                              if (window.confirm("이미지를 제외하고 이 질문을 바로 게시할까요?"))
                                void action(item, "TEXT_ONLY");
                            }}
                          >
                            이미지 없이 게시
                          </button>
                        </>
                      ) : null}
                      <div className={styles.moreActions} data-submission-actions-menu>
                        <button
                          className={styles.moreButton}
                          type="button"
                          aria-label={`${item.question} 더보기`}
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-controls={`submission-actions-${item.id}`}
                          disabled={busy}
                          onClick={() => {
                            setOpenMenuId(menuOpen ? null : item.id);
                            setEditing(null);
                            setLibraryTarget(null);
                          }}
                        >
                          <span aria-hidden="true">•••</span>
                          더보기
                        </button>
                        {menuOpen ? (
                          <div
                            className={styles.actionMenu}
                            id={`submission-actions-${item.id}`}
                            role="menu"
                          >
                            {editable ? (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const result = await loadIssueMediaLibrary();
                                    setLibrary(result.items);
                                    setLibraryTarget(item);
                                    setLibrarySelections([]);
                                    setEditing(null);
                                    setOpenMenuId(null);
                                  })
                                }
                              >
                                <Image
                                  className={styles.actionIcon}
                                  src="/icons/image.png"
                                  width={18}
                                  height={18}
                                  alt=""
                                  aria-hidden="true"
                                />
                                라이브러리 이미지로 교체
                              </button>
                            ) : null}
                            <button
                              className={styles.cancelMenuItem}
                              type="button"
                              role="menuitem"
                              disabled={busy}
                              onClick={() => {
                                setOpenMenuId(null);
                                if (
                                  window.confirm(
                                    failed
                                      ? "게시 실패한 질문을 삭제할까요? 질문 DB 기록과 다른 곳에서 사용하지 않는 업로드 이미지도 함께 삭제되며 복구할 수 없습니다."
                                      : "이 질문 제출을 취소할까요? 취소한 제출은 다시 게시되지 않아요.",
                                  )
                                )
                                  void action(item, failed ? "DELETE" : "CANCEL");
                              }}
                            >
                              <Image
                                className={styles.actionIcon}
                                src="/icons/delete.png"
                                width={18}
                                height={18}
                                alt=""
                                aria-hidden="true"
                              />
                              {failed ? "목록에서 삭제" : "제출 취소"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {editing?.id === item.id ? (
                    <form
                      className={`${styles.form} ${styles.editorForm}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                      }}
                    >
                      <div className={styles.editorHeading}>
                        <div>
                          <span>EDIT QUESTION</span>
                          <h4>질문과 이미지를 수정해 보세요.</h4>
                        </div>
                        <small>다음 수정본 v{editing.revision + 1}</small>
                      </div>
                      <label className={styles.editorField}>
                        <span>질문</span>
                        <input
                          aria-label="질문"
                          required
                          minLength={5}
                          maxLength={120}
                          value={editing.question}
                          onChange={(event) => {
                            setEditing({ ...editing, question: event.target.value });
                            key.current = crypto.randomUUID();
                          }}
                        />
                        <small>{Array.from(editing.question).length}/120</small>
                      </label>
                      <label className={styles.editorField}>
                        <span>
                          짧은 설명 <em>선택</em>
                        </span>
                        <textarea
                          aria-label="짧은 설명"
                          maxLength={240}
                          value={editing.context ?? ""}
                          onChange={(event) => {
                            setEditing({ ...editing, context: event.target.value });
                            key.current = crypto.randomUUID();
                          }}
                        />
                        <small>{Array.from(editing.context ?? "").length}/240</small>
                      </label>
                      <div className={styles.editorChoiceGrid}>
                        {submissionChoiceCodes(editing).map((code, index) => (
                          <label className={styles.editorChoiceField} data-side={code} key={code}>
                            <span>
                              <b>{code}</b> {index + 1}번째 선택
                            </span>
                            <input
                              aria-label={`${code} 선택지`}
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
                      <div className={styles.editorChoiceControls}>
                        {submissionChoiceCodes(editing).length < 4 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const nextCode = CHOICE_CODES[submissionChoiceCodes(editing).length]!;
                              setEditing({ ...editing, [CHOICE_FIELD[nextCode]]: "" });
                              key.current = crypto.randomUUID();
                            }}
                          >
                            + 선택지 추가
                          </button>
                        ) : null}
                        {submissionChoiceCodes(editing).length > 2 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const removed = submissionChoiceCodes(editing).at(-1)!;
                              setEditing({
                                ...editing,
                                [CHOICE_FIELD[removed]]: null,
                                [MEDIA_FIELD[removed]]: null,
                              });
                              setFiles((current) => ({ ...current, [removed]: null }));
                              key.current = crypto.randomUUID();
                            }}
                          >
                            마지막 선택지 삭제
                          </button>
                        ) : null}
                        <small>선택지는 2개부터 최대 4개까지 수정할 수 있어요.</small>
                      </div>
                      <fieldset className={styles.editorMediaPicker}>
                        <legend>직접 업로드 이미지</legend>
                        <p>
                          설명 이미지는 단독으로 교체할 수 있어요. 선택지 이미지를 사용한다면 현재
                          선택지 모두에 이미지가 필요하며, 새 이미지는 다시 안전 검사를 거칩니다.
                        </p>
                        <div className={styles.editorUploadGrid}>
                          <label data-side="CONTEXT" data-selected={Boolean(contextFile)}>
                            {contextPreview ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={contextPreview} alt="새 설명 이미지 미리보기" />
                            ) : (
                              <b>설명</b>
                            )}
                            <span>
                              {contextFile?.name ??
                                (editing.contextMediaAssetId
                                  ? "기존 설명 이미지 유지"
                                  : "짧은 설명 이미지 선택")}
                            </span>
                            <input
                              disabled={busy}
                              type="file"
                              aria-label="설명 새 이미지"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(event) => {
                                setContextFile(event.target.files?.[0] ?? null);
                                key.current = crypto.randomUUID();
                              }}
                            />
                          </label>
                          {submissionChoiceCodes(editing).map((code) => (
                            <label data-side={code} data-selected={Boolean(files[code])} key={code}>
                              {filePreviews[code] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={filePreviews[code]!} alt={`${code} 새 이미지 미리보기`} />
                              ) : (
                                <b>{code}</b>
                              )}
                              <span>
                                {files[code]?.name ??
                                  (editing[MEDIA_FIELD[code]]
                                    ? `기존 ${code} 이미지 유지`
                                    : `${code} 선택 이미지`)}
                              </span>
                              <input
                                disabled={busy}
                                type="file"
                                aria-label={`${code} 새 이미지`}
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
                      </fieldset>
                      <div className={`${styles.actions} ${styles.editorActions}`}>
                        <button className={styles.primary} disabled={busy} type="submit">
                          수정본 제출
                        </button>
                        <button
                          disabled={busy}
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setFiles(emptyFiles());
                            setContextFile(null);
                          }}
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
                            이미지가 선택된 순서대로 {submissionChoiceCodes(item).join(" · ")}에
                            배치돼요. 서로 다른 묶음의 이미지도 함께 고를 수 있어요.
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
                                        if (current.length >= submissionChoiceCodes(item).length) {
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
        ) : null}
      </div>
    </WhichShell>
  );
}
