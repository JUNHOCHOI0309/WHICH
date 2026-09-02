"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import type {
  CreateIssueCommand,
  ChoiceCode,
  InterestCardRegistry,
  IssueMediaUploadAccess,
  IssueMediaLibraryPair,
} from "@/lib/contracts";

import {
  acceptIssueMediaConsent,
  attachIssueSubmissionMedia,
  createMemberIssue,
  loadIssueCreationContext,
  loadIssueMediaLibrary,
  submitMemberIssue,
  uploadIssueSubmissionMedia,
} from "./issue-creator-client";
import styles from "./issue-creator-experience.module.css";
import { trackSubmission } from "./submission-feedback";

const DRAFT_KEY = "which_issue_draft_v1";
const EMPTY_DRAFT: CreateIssueCommand = {
  question: "",
  context: "",
  choiceA: "",
  choiceB: "",
  choiceC: null,
  choiceD: null,
  libraryAssetIds: null,
  interestCardCode: "DAILY_LIFE",
};
const CHOICE_CODES = ["A", "B", "C", "D"] as const;
const CHOICE_FIELDS: Record<ChoiceCode, "choiceA" | "choiceB" | "choiceC" | "choiceD"> = {
  A: "choiceA",
  B: "choiceB",
  C: "choiceC",
  D: "choiceD",
};
const MEDIA_FIELDS: Record<
  ChoiceCode,
  "mediaAssetAId" | "mediaAssetBId" | "mediaAssetCId" | "mediaAssetDId"
> = {
  A: "mediaAssetAId",
  B: "mediaAssetBId",
  C: "mediaAssetCId",
  D: "mediaAssetDId",
};

function initialDraft() {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  const saved = window.sessionStorage.getItem(DRAFT_KEY);
  if (!saved) return EMPTY_DRAFT;
  try {
    return { ...EMPTY_DRAFT, ...(JSON.parse(saved) as Partial<CreateIssueCommand>) };
  } catch {
    window.sessionStorage.removeItem(DRAFT_KEY);
    return EMPTY_DRAFT;
  }
}

function useObjectUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

export function IssueCreatorExperience({
  presentation = "page",
  onSubmitted,
}: {
  presentation?: "page" | "modal";
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "guest" | "member" | "error">("loading");
  const [registry, setRegistry] = useState<InterestCardRegistry | null>(null);
  const [library, setLibrary] = useState<IssueMediaLibraryPair[]>([]);
  const [mediaAccess, setMediaAccess] = useState<IssueMediaUploadAccess | null>(null);
  const [libraryState, setLibraryState] = useState<"loading" | "ready" | "error">("loading");
  const [mediaMode, setMediaMode] = useState<"TEXT_ONLY" | "LIBRARY" | "DIRECT">(
    initialDraft().libraryPairId || initialDraft().libraryAssetIds?.length
      ? "LIBRARY"
      : "TEXT_ONLY",
  );
  const [draft, setDraft] = useState<CreateIssueCommand>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [acceptingMediaTerms, setAcceptingMediaTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directFiles, setDirectFiles] = useState<Record<"CONTEXT" | ChoiceCode, File | null>>({
    CONTEXT: null,
    A: null,
    B: null,
    C: null,
    D: null,
  });
  const directPreviewContext = useObjectUrl(directFiles.CONTEXT);
  const directPreviewA = useObjectUrl(directFiles.A);
  const directPreviewB = useObjectUrl(directFiles.B);
  const directPreviewC = useObjectUrl(directFiles.C);
  const directPreviewD = useObjectUrl(directFiles.D);
  const directPreviews: Record<ChoiceCode, string | null> = {
    A: directPreviewA,
    B: directPreviewB,
    C: directPreviewC,
    D: directPreviewD,
  };
  const pendingKey = useRef<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    void loadIssueCreationContext()
      .then(async (context) => {
        if (!context.authenticated) {
          setState("guest");
          return;
        }
        setMediaAccess(context.mediaAccess);
        const libraryResult = await loadIssueMediaLibrary().catch(() => null);
        if (libraryResult) {
          setLibrary(libraryResult.items);
          setLibraryState("ready");
        } else {
          setLibraryState("error");
        }
        setRegistry(context.registry);
        setState("member");
      })
      .catch(() => setState("error"));
  }, []);

  const update = <K extends keyof CreateIssueCommand>(key: K, value: CreateIssueCommand[K]) => {
    setError(null);
    setDraft((current) => {
      const next = { ...current, [key]: value };
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    });
    pendingKey.current = null;
  };

  if (state === "loading") {
    return <section className={styles.panel}>질문 작성 환경을 준비하는 중…</section>;
  }

  if (state === "guest") {
    return (
      <section className={`${styles.panel} ${styles.guestPanel}`}>
        <p className={styles.eyebrow}>MEMBER CREATION</p>
        <h1>질문은 Member가 만들 수 있어요.</h1>
        <p>
          작성 중인 내용은 이 브라우저에 잠시 보관됩니다. 로그인하거나 빠르게 가입한 뒤 그대로
          이어서 작성하세요.
        </p>
        <Link
          className={styles.primaryLink}
          href={
            presentation === "modal"
              ? "/login?returnTo=%2F%3Fcompose%3Dquestion"
              : "/login?returnTo=%2Fcreate"
          }
        >
          로그인하고 질문 만들기 <span aria-hidden="true">→</span>
        </Link>
      </section>
    );
  }

  if (state === "error" || !registry) {
    return (
      <section className={styles.panel}>
        질문 작성 환경을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </section>
    );
  }

  const selectedLabel =
    registry.cards.find((card) => card.code === draft.interestCardCode)?.label ?? "생활";
  const libraryAssets = library.flatMap((pair) =>
    pair.assets.map((asset) => ({ ...asset, pairId: pair.id, pairTitle: pair.title })),
  );
  const selectedLibraryAssetIds = draft.libraryAssetIds ?? [];
  const selectedLibraryAssets = selectedLibraryAssetIds.flatMap((id) => {
    const asset = libraryAssets.find((candidate) => candidate.id === id);
    return asset ? [asset] : [];
  });
  const activeChoiceCodes = CHOICE_CODES.filter((code) => {
    if (code === "A" || code === "B") return true;
    return draft[CHOICE_FIELDS[code]] !== null && draft[CHOICE_FIELDS[code]] !== undefined;
  });
  const hasAnyDirectFile = Object.values(directFiles).some(Boolean);
  const hasAnyChoiceFile = activeChoiceCodes.some((code) => Boolean(directFiles[code]));
  const hasCompleteChoiceFiles = activeChoiceCodes.every((code) => Boolean(directFiles[code]));

  return (
    <form
      className={`${styles.form} ${presentation === "modal" ? styles.modalForm : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        setError(null);
        pendingKey.current ??= crypto.randomUUID();
        const publish = async () => {
          if (mediaMode !== "DIRECT") {
            const result = await createMemberIssue(draft, pendingKey.current!);
            return { kind: "PUBLISHED" as const, issueId: result.issue.id };
          }
          if (
            !mediaAccess?.allowed ||
            !hasAnyDirectFile ||
            (hasAnyChoiceFile && !hasCompleteChoiceFiles)
          ) {
            throw new Error("설명 이미지 또는 사용 중인 모든 선택지 이미지를 확인해 주세요.");
          }
          const base = {
            ...draft,
            libraryPairId: null,
            libraryAssetIds: null,
            contextMediaAssetId: null,
            mediaAssetAId: null,
            mediaAssetBId: null,
            mediaAssetCId: null,
            mediaAssetDId: null,
          };
          const result = await submitMemberIssue(base, pendingKey.current!);
          const uploadTargets = (["CONTEXT", ...activeChoiceCodes] as const).filter((target) =>
            Boolean(directFiles[target]),
          );
          // The API deliberately allows only two native image-processing jobs at once.
          // A single issue can contain a context image plus A-D, so upload this draft in
          // order instead of making the third image compete with its own request.
          const uploaded: Array<{
            target: (typeof uploadTargets)[number];
            asset: { id: string };
          }> = [];
          for (const target of uploadTargets) {
            uploaded.push({
              target,
              asset: (await uploadIssueSubmissionMedia(result.submission.id, directFiles[target]!))
                .asset,
            });
          }
          const mediaAssets: Pick<
            CreateIssueCommand,
            | "contextMediaAssetId"
            | "mediaAssetAId"
            | "mediaAssetBId"
            | "mediaAssetCId"
            | "mediaAssetDId"
          > = {};
          for (const item of uploaded) {
            if (item.target === "CONTEXT") mediaAssets.contextMediaAssetId = item.asset.id;
            else mediaAssets[MEDIA_FIELDS[item.target]] = item.asset.id;
          }
          const attached = await attachIssueSubmissionMedia(
            result.submission,
            base,
            mediaAssets,
            crypto.randomUUID(),
          );
          return { kind: "PENDING" as const, submission: attached.submission };
        };
        void publish()
          .then((result) => {
            window.sessionStorage.removeItem(DRAFT_KEY);
            pendingKey.current = null;
            onSubmitted?.();
            if (result.kind === "PUBLISHED") {
              toast.success("질문을 게시했어요.");
              if (presentation === "page") router.push(`/issues/${result.issueId}`);
            } else {
              trackSubmission(result.submission);
              toast.info("질문을 접수했어요. 안전 검사를 거쳐 게시 결과를 알려드릴게요.");
              if (presentation === "page") router.push("/me/submissions");
            }
          })
          .catch((reason) => {
            const status =
              typeof reason === "object" && reason !== null && "status" in reason
                ? Number(reason.status)
                : 0;
            if (status === 401) setState("guest");
            const message = reason instanceof Error ? reason.message : "질문을 만들지 못했습니다.";
            setError(message);
            toast.error(message);
          })
          .finally(() => {
            submittingRef.current = false;
            setSubmitting(false);
          });
      }}
    >
      <section className={styles.panel}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>CREATE YOUR CHOICE</p>
            <h1>사람들에게 어떤 선택을 물어볼까요?</h1>
          </div>
        </div>

        <label className={styles.field}>
          <span>질문</span>
          <input
            value={draft.question}
            onChange={(event) => update("question", event.target.value)}
            maxLength={120}
            placeholder="예: 퇴근 후 바로 잘까, 조금 더 놀까?"
            required
          />
          <small>
            {Array.from(draft.question).length}/120 · 물음표는 빠져 있어도 자동으로 붙여드려요.
          </small>
        </label>

        <label className={styles.field}>
          <span>
            짧은 설명 <em>선택</em>
          </span>
          <textarea
            value={draft.context ?? ""}
            onChange={(event) => update("context", event.target.value)}
            maxLength={240}
            placeholder="선택할 때 생각해 볼 상황을 한 줄로 덧붙여 보세요."
          />
          <small>{Array.from(draft.context ?? "").length}/240</small>
        </label>

        <div className={styles.choiceGrid}>
          {activeChoiceCodes.map((code, index) => {
            const field = CHOICE_FIELDS[code];
            return (
              <label className={styles.choiceField} data-side={code} key={code}>
                <span>
                  <b>{code}</b> {index + 1}번째 선택
                </span>
                <input
                  value={draft[field] ?? ""}
                  onChange={(event) => update(field, event.target.value)}
                  maxLength={50}
                  placeholder={`${index + 1}번째 선택지를 적어 주세요`}
                  required
                />
              </label>
            );
          })}
        </div>
        <div className={styles.choiceControls}>
          {activeChoiceCodes.length < 4 ? (
            <button
              type="button"
              onClick={() => {
                const nextCode = CHOICE_CODES[activeChoiceCodes.length]!;
                update(CHOICE_FIELDS[nextCode], "");
                update("libraryPairId", null);
              }}
            >
              + 선택지 추가
            </button>
          ) : null}
          {activeChoiceCodes.length > 2 ? (
            <button
              type="button"
              onClick={() => {
                const removed = activeChoiceCodes.at(-1)!;
                update(CHOICE_FIELDS[removed], null);
                update("libraryPairId", null);
                update(
                  "libraryAssetIds",
                  selectedLibraryAssetIds.slice(0, activeChoiceCodes.length - 1),
                );
                setDirectFiles((current) => ({ ...current, [removed]: null }));
              }}
            >
              마지막 선택지 삭제
            </button>
          ) : null}
          <small>선택지는 2개부터 최대 4개까지 만들 수 있어요.</small>
        </div>

        <fieldset className={styles.mediaPicker}>
          <legend>이미지 방식</legend>
          <div className={styles.mediaModes}>
            <button
              type="button"
              data-active={mediaMode === "TEXT_ONLY"}
              onClick={() => {
                setMediaMode("TEXT_ONLY");
                update("libraryPairId", null);
                update("libraryAssetIds", null);
                setDirectFiles({ CONTEXT: null, A: null, B: null, C: null, D: null });
              }}
            >
              텍스트만
            </button>
            <button
              type="button"
              data-active={mediaMode === "LIBRARY"}
              title="검수가 끝난 이미지를 선택지 수만큼 고릅니다."
              onClick={() => setMediaMode("LIBRARY")}
            >
              승인 이미지 Library
            </button>
            <button
              type="button"
              data-active={mediaMode === "DIRECT"}
              disabled={!mediaAccess?.allowed}
              title={
                mediaAccess?.allowed
                  ? "선택지 이미지를 직접 올립니다."
                  : mediaAccess?.reasons.includes("ACCOUNT_RESTRICTED")
                    ? "최근 신고 누적으로 새 이미지 업로드가 잠시 제한되었습니다."
                    : "이미지 업로드 약관 동의 후 사용할 수 있습니다."
              }
              onClick={() => {
                setMediaMode("DIRECT");
                update("libraryPairId", null);
                update("libraryAssetIds", null);
              }}
            >
              직접 업로드
            </button>
          </div>
          {mediaAccess &&
          mediaAccess.mode !== "OFF" &&
          mediaAccess.reasons.includes("CONSENT_REQUIRED") ? (
            <div className={styles.mediaConsent}>
              <p>
                이미지 직접 업로드 전에 현재 <Link href="/legal/terms">이용약관</Link>과{" "}
                <Link href="/legal/privacy">개인정보 처리방침</Link>의 콘텐츠 권리·자동 안전 검사·
                OpenAI 국외 처리 및 보존 조건을 한 번 확인해 주세요. 동의하지 않아도 텍스트 질문은
                작성할 수 있습니다.
              </p>
              <button
                type="button"
                disabled={acceptingMediaTerms}
                onClick={() => {
                  setAcceptingMediaTerms(true);
                  void acceptIssueMediaConsent()
                    .then(({ access }) => {
                      setMediaAccess(access);
                      toast.success("이미지 업로드 약관에 동의했어요.");
                    })
                    .catch((reason) =>
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : "이미지 업로드 약관 동의를 저장하지 못했습니다.",
                      ),
                    )
                    .finally(() => setAcceptingMediaTerms(false));
                }}
              >
                {acceptingMediaTerms ? "저장 중…" : "확인하고 동의"}
              </button>
            </div>
          ) : null}
          {mediaMode === "LIBRARY" ? (
            <div className={styles.libraryPanel}>
              <p>
                검수가 끝난 이미지를 선택지 수만큼 골라 주세요. 고른 순서대로 A/B/C/D가 배정되고,
                같은 이미지를 다시 누르면 선택이 해제됩니다.
              </p>
              <strong className={styles.librarySelectionCount}>
                {selectedLibraryAssetIds.length}/{activeChoiceCodes.length} 선택
              </strong>
              {libraryState === "loading" ? <span>Library를 불러오는 중…</span> : null}
              {libraryState === "error" ? <span>Library를 잠시 불러오지 못했습니다.</span> : null}
              {libraryState === "ready" && library.length === 0 ? (
                <span>현재 사용할 수 있는 이미지가 없습니다.</span>
              ) : null}
              <div className={styles.libraryGrid}>
                {libraryAssets.map((asset) => {
                  const selectedIndex = selectedLibraryAssetIds.indexOf(asset.id);
                  const assignment = selectedIndex >= 0 ? activeChoiceCodes[selectedIndex] : null;
                  return (
                    <button
                      type="button"
                      key={asset.id}
                      aria-label={`${asset.pairTitle} · ${asset.altText}`}
                      data-selected={selectedIndex >= 0}
                      data-assignment={assignment ?? undefined}
                      onClick={() => {
                        update("libraryPairId", null);
                        if (selectedIndex >= 0) {
                          update(
                            "libraryAssetIds",
                            selectedLibraryAssetIds.filter((id) => id !== asset.id),
                          );
                          return;
                        }
                        if (selectedLibraryAssetIds.length >= activeChoiceCodes.length) {
                          toast.info(
                            "선택지 수만큼 골랐어요. 다른 이미지를 해제한 뒤 선택해 주세요.",
                          );
                          return;
                        }
                        update("libraryAssetIds", [...selectedLibraryAssetIds, asset.id]);
                      }}
                    >
                      <span className={styles.libraryAssetImage}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={asset.url} alt={asset.altText} />
                        {assignment ? <b>{assignment}</b> : null}
                      </span>
                      <strong>{asset.pairTitle}</strong>
                      <small>{asset.altText}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {mediaMode === "DIRECT" && mediaAccess?.allowed ? (
            <div className={styles.directUploadPanel}>
              <p>
                설명 이미지는 단독으로 첨부할 수 있어요. 선택지 이미지도 넣는다면 현재 선택지 모두에
                이미지를 골라 주세요. 등록 즉시 비공개 안전 검사를 거칩니다.
              </p>
              <div>
                <label data-side="CONTEXT">
                  <b>설명</b>
                  <span>{directFiles.CONTEXT?.name ?? "짧은 설명 이미지"}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) =>
                      setDirectFiles((current) => ({
                        ...current,
                        CONTEXT: event.target.files?.[0] ?? null,
                      }))
                    }
                  />
                </label>
                {activeChoiceCodes.map((side) => (
                  <label key={side} data-side={side}>
                    <b>{side}</b>
                    <span>{directFiles[side]?.name ?? `${side} 선택 이미지`}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) =>
                        setDirectFiles((current) => ({
                          ...current,
                          [side]: event.target.files?.[0] ?? null,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </fieldset>

        <fieldset className={styles.categories}>
          <legend>관심 주제</legend>
          <div>
            {registry.cards.map((card) => (
              <label key={card.code}>
                <input
                  type="radio"
                  name="interest-card"
                  checked={draft.interestCardCode === card.code}
                  onChange={() => update("interestCardCode", card.code)}
                />
                <span>{card.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={`${styles.panel} ${styles.preview}`} aria-label="질문 미리보기">
        <div className={styles.previewMeta}>
          <span>PREVIEW</span>
          <b>{selectedLabel}</b>
        </div>
        <h2>{draft.question.trim() || "질문이 여기에 표시됩니다."}</h2>
        {draft.context?.trim() ? <p>{draft.context}</p> : null}
        {directPreviewContext ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.previewContextImage}
            src={directPreviewContext}
            alt="짧은 설명 이미지 미리보기"
          />
        ) : null}
        {activeChoiceCodes.map((code, index) => {
          const libraryAsset = selectedLibraryAssets[index];
          const preview = directPreviews[code];
          return (
            <div className={styles.previewChoice} data-side={code} key={code}>
              {libraryAsset ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={libraryAsset.url} alt={libraryAsset.altText} />
              ) : preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={`${code} 선택 이미지 미리보기`} />
              ) : null}
              <b>{code}</b>
              <span>{draft[CHOICE_FIELDS[code]] || `${index + 1}번째 선택`}</span>
            </div>
          );
        })}
      </section>

      <div className={styles.submitBar}>
        <p>
          {mediaMode === "DIRECT"
            ? "선택한 이미지는 비공개 안전 검사를 거친 뒤 공개됩니다."
            : selectedLibraryAssets.length === activeChoiceCodes.length
              ? "승인 Library 이미지와 함께 바로 피드에 표시됩니다."
              : "공개 후 바로 피드에 표시됩니다."}{" "}
          링크·정치·고위험 주제는 v1에서 게시할 수 없어요.
        </p>
        <button
          type="submit"
          disabled={
            submitting ||
            (mediaMode === "LIBRARY" &&
              selectedLibraryAssetIds.length !== activeChoiceCodes.length) ||
            (mediaMode === "DIRECT" &&
              (!hasAnyDirectFile || (hasAnyChoiceFile && !hasCompleteChoiceFiles)))
          }
        >
          {submitting ? "게시 요청 중…" : "질문 게시"}
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
